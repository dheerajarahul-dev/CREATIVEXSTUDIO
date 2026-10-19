import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext, roleAllowed, roles } from "@/lib/authz";

const inviteSchema = z.object({
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  role: z.enum(roles.filter((role) => role !== "super_admin")),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation details" }, { status: 400 });

  const workspaceId = request.nextUrl.searchParams.get("workspace");
  const context = await getAuthContext(workspaceId ?? undefined);
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!roleAllowed(context.role, ["super_admin"])) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url || !secretKey || !siteUrl) return NextResponse.json({ error: "Invitation service is not configured" }, { status: 503 });

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: canInvite, error: rateLimitError } = await admin.rpc("consume_workspace_invite_rate_limit", { target_user: context.user.id });
  if (rateLimitError) return NextResponse.json({ error: "Invitation service is temporarily unavailable" }, { status: 503 });
  if (!canInvite) return NextResponse.json({ error: "Invitation limit reached. Try again in 15 minutes." }, { status: 429 });

  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/callback`,
  });
  if (inviteError || !invitation.user) {
    return NextResponse.json({ error: "Invitation could not be created. Check the address and existing account status." }, { status: 409 });
  }

  const { error: recordError } = await admin.from("workspace_invitations").upsert({
    workspace_id: context.workspaceId,
    email: parsed.data.email,
    role: parsed.data.role,
    auth_user_id: invitation.user.id,
    invited_by: context.user.id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
  }, { onConflict: "workspace_id,email" });
  if (recordError) return NextResponse.json({ error: "Invitation email was accepted by Auth, but its workspace record could not be saved. Contact an administrator." }, { status: 500 });

  return NextResponse.json({ status: "requested", message: "Invitation request accepted by Auth. Delivery depends on the configured email provider." }, { status: 202 });
}
