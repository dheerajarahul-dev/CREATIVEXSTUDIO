import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/authz";
import { getStorageBucketName } from "@/lib/supabase/env";

const completionSchema = z.object({
  projectId: z.string().uuid(),
  path: z.string().min(40).max(512),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(120),
  size: z.number().int().positive().max(5 * 1024 ** 3),
  category: z.enum(["raw_video", "work_in_progress", "final_video", "audio", "image", "document", "subtitle", "project_file", "reference", "misc"]),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.path.startsWith(`${parsed.data.projectId}/`)) return NextResponse.json({ error: "Invalid upload record" }, { status: 400 });

  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data: files, error: listError } = await context.supabase.storage.from(getStorageBucketName()).list(parsed.data.projectId, { search: parsed.data.path.slice(parsed.data.projectId.length + 1) });
  if (listError) return NextResponse.json({ error: "Uploaded object is unavailable" }, { status: 403 });
  const objectName = parsed.data.path.slice(parsed.data.projectId.length + 1);
  const object = files?.find((file) => file.name === objectName);
  if (!object || Number(object.metadata?.size) !== parsed.data.size || object.metadata?.mimetype !== parsed.data.type) {
    return NextResponse.json({ error: "Uploaded object metadata did not match the authorized request" }, { status: 409 });
  }

  const { data: asset, error } = await context.supabase.from("media_assets").insert({
    workspace_id: context.workspaceId,
    project_id: parsed.data.projectId,
    storage_path: parsed.data.path,
    original_name: parsed.data.name,
    mime_type: parsed.data.type,
    byte_size: parsed.data.size,
    category: parsed.data.category,
    uploaded_by: context.user.id,
  }).select("id, original_name, mime_type, byte_size, category, created_at").single();
  if (error || !asset) return NextResponse.json({ error: "Asset record could not be saved" }, { status: 403 });
  return NextResponse.json({ asset }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
