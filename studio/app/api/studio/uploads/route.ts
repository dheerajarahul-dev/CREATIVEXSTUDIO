import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/authz";
import { getStorageBucketName, getSupabaseEnvironment } from "@/lib/supabase/env";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(120),
  size: z.number().int().positive().max(5 * 1024 ** 3),
  category: z.enum(["raw_video", "work_in_progress", "final_video", "audio", "image", "document", "subtitle", "project_file", "reference", "misc"]),
});
const mimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/wav", "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "application/zip", "application/x-zip-compressed"]);

function safeFileName(name: string) {
  const normalized = name.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/\.\.+/g, "_").trim();
  return normalized.slice(-180) || "upload.bin";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !mimeTypes.has(parsed.data.type.toLowerCase())) return NextResponse.json({ error: "Unsupported file or invalid upload details" }, { status: 400 });

  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!["super_admin", "agency_manager", "video_editor", "client"].includes(context.role)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const { data: project, error: projectError } = await context.supabase.from("projects")
    .select("id").eq("id", parsed.data.projectId).maybeSingle();
  if (projectError || !project) return NextResponse.json({ error: "Project unavailable" }, { status: 404 });

  const objectPath = `${parsed.data.projectId}/${randomUUID()}-${safeFileName(parsed.data.name)}`;
  const environment = getSupabaseEnvironment();
  if (!environment) return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });

  return NextResponse.json({
    bucket: getStorageBucketName(),
    path: objectPath,
    endpoint: `${environment.url.replace(/\/$/, "")}/storage/v1/upload/resumable`,
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
