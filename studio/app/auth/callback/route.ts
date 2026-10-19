import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safePath(value: string | null) {
  return value?.startsWith("/auth/reset") && !value.startsWith("//") ? value : "/studio";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safePath(request.nextUrl.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (next !== "/auth/reset") {
        const { error: invitationError } = await supabase.rpc("accept_workspace_invitation");
        if (invitationError) return NextResponse.redirect(new URL("/login?error=invitation", request.url));
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=invalid", request.url));
}
