"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext, roleAllowed } from "@/lib/authz";
import { getStorageBucketName } from "@/lib/supabase/env";

const requestSchema = z.object({
  title: z.string().trim().min(2).max(180),
  project_type: z.string().trim().min(2).max(80),
  company_name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(10000),
  target_audience: z.string().trim().max(500),
  platforms: z.string().trim().max(300),
  duration: z.string().trim().max(80),
  deadline: z.union([z.literal(""), z.iso.date()]),
  budget: z.string().trim().max(80),
});

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry : "";
}

export async function createProjectRequestAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");
  if (context.role !== "client") redirect("/studio?error=forbidden");

  const parsed = requestSchema.safeParse({
    title: value(formData, "title"), project_type: value(formData, "project_type"),
    company_name: value(formData, "company_name"), description: value(formData, "description"),
    target_audience: value(formData, "target_audience"), platforms: value(formData, "platforms"),
    duration: value(formData, "duration"), deadline: value(formData, "deadline"), budget: value(formData, "budget"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { data: existingClient, error: findClientError } = await context.supabase
    .from("clients")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (findClientError) redirect("/studio?error=save");

  const { data: client, error: clientError } = existingClient
    ? { data: existingClient, error: null }
    : await context.supabase
    .from("clients")
    .insert({ workspace_id: context.workspaceId, user_id: context.user.id, company_name: parsed.data.company_name, primary_email: context.user.email?.toLowerCase() ?? null })
    .select("id")
    .single();
  if (clientError || !client) redirect("/studio?error=save");

  const { error } = await context.supabase.from("project_requests").insert({
    workspace_id: context.workspaceId,
    client_id: client.id,
    requested_by: context.user.id,
    title: parsed.data.title,
    project_type: parsed.data.project_type,
    brief: {
      description: parsed.data.description,
      target_audience: parsed.data.target_audience,
      platforms: parsed.data.platforms.split(",").map((item) => item.trim()).filter(Boolean),
      duration: parsed.data.duration,
      requested_deadline: parsed.data.deadline || null,
      budget_range: parsed.data.budget || null,
    },
  });
  if (error) redirect("/studio?error=save");
  revalidatePath("/studio");
  redirect("/studio?submitted=1");
}

export async function acceptProjectRequestAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");
  if (!roleAllowed(context.role, ["super_admin", "agency_manager"])) redirect("/studio?error=forbidden");

  const parsed = z.object({ request_id: z.string().uuid(), editor_id: z.union([z.literal(""), z.string().uuid()]) }).safeParse({
    request_id: value(formData, "request_id"),
    editor_id: value(formData, "editor_id"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { data, error } = await context.supabase.rpc("accept_project_request", { target_request: parsed.data.request_id, assigned_editor: parsed.data.editor_id || null });
  if (error || !data) redirect("/studio?error=transition");
  revalidatePath("/studio");
  redirect("/studio?accepted=1");
}

export async function createProjectTaskAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");
  if (!roleAllowed(context.role, ["super_admin", "agency_manager"])) redirect("/studio?error=forbidden");

  const parsed = z.object({
    project_id: z.string().uuid(),
    title: z.string().trim().min(2).max(180),
    assignee_id: z.union([z.literal(""), z.string().uuid()]),
    due_at: z.union([z.literal(""), z.iso.datetime({ local: true })]),
  }).safeParse({
    project_id: value(formData, "project_id"),
    title: value(formData, "title"),
    assignee_id: value(formData, "assignee_id"),
    due_at: value(formData, "due_at"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { error } = await context.supabase.from("tasks").insert({
    workspace_id: context.workspaceId,
    project_id: parsed.data.project_id,
    title: parsed.data.title,
    assignee_id: parsed.data.assignee_id || null,
    due_at: parsed.data.due_at || null,
    created_by: context.user.id,
  });
  if (error) redirect(`/studio/${parsed.data.project_id}?error=task`);
  revalidatePath(`/studio/${parsed.data.project_id}`);
}

export async function downloadProjectAssetAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  const parsed = z.object({ project_id: z.string().uuid(), asset_id: z.string().uuid() }).safeParse({
    project_id: value(formData, "project_id"),
    asset_id: value(formData, "asset_id"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { data: asset, error: assetError } = await context.supabase.from("media_assets")
    .select("storage_path, original_name").eq("id", parsed.data.asset_id).eq("project_id", parsed.data.project_id).is("deleted_at", null).maybeSingle();
  if (assetError || !asset) redirect(`/studio/${parsed.data.project_id}?error=download`);

  const { data, error } = await context.supabase.storage.from(getStorageBucketName())
    .createSignedUrl(asset.storage_path, 300, { download: asset.original_name });
  if (error || !data?.signedUrl) redirect(`/studio/${parsed.data.project_id}?error=download`);
  redirect(data.signedUrl);
}

export async function submitVideoVersionAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");
  if (!roleAllowed(context.role, ["super_admin", "agency_manager", "video_editor"])) redirect("/studio?error=forbidden");

  const parsed = z.object({
    project_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    label: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(5000),
    submit_for_review: z.enum(["yes", "no"]),
  }).safeParse({
    project_id: value(formData, "project_id"),
    asset_id: value(formData, "asset_id"),
    label: value(formData, "label"),
    notes: value(formData, "notes"),
    submit_for_review: value(formData, "submit_for_review"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { data: versionId, error } = await context.supabase.rpc("submit_video_version", {
    target_project: parsed.data.project_id,
    target_asset: parsed.data.asset_id,
    version_label: parsed.data.label,
    version_notes: parsed.data.notes,
    submit_for_review: parsed.data.submit_for_review === "yes",
  });
  if (error || !versionId) redirect(`/studio/${parsed.data.project_id}?error=version`);

  revalidatePath(`/studio/${parsed.data.project_id}`);
  revalidatePath("/studio");
  redirect(`/studio/${parsed.data.project_id}?versionSubmitted=1`);
}

export async function addReviewCommentAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  const parsed = z.object({
    project_id: z.string().uuid(),
    version_id: z.string().uuid(),
    body: z.string().trim().min(1).max(5000),
    time_seconds: z.coerce.number().min(0).max(86400),
  }).safeParse({
    project_id: value(formData, "project_id"),
    version_id: value(formData, "version_id"),
    body: value(formData, "body"),
    time_seconds: value(formData, "time_seconds"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { error } = await context.supabase.from("review_comments").insert({
    project_id: parsed.data.project_id,
    version_id: parsed.data.version_id,
    author_id: context.user.id,
    body: parsed.data.body,
    time_seconds: parsed.data.time_seconds,
  });
  if (error) redirect(`/studio/${parsed.data.project_id}?error=comment`);
  revalidatePath(`/studio/${parsed.data.project_id}`);
}

export async function updateTaskStatusAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  const parsed = z.object({
    project_id: z.string().uuid(),
    task_id: z.string().uuid(),
    status: z.enum(["todo", "in_progress", "blocked", "completed", "cancelled"]),
  }).safeParse({
    project_id: value(formData, "project_id"),
    task_id: value(formData, "task_id"),
    status: value(formData, "status"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { error } = await context.supabase.from("tasks").update({
    status: parsed.data.status,
    completed_at: parsed.data.status === "completed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.task_id).eq("project_id", parsed.data.project_id);
  if (error) redirect(`/studio/${parsed.data.project_id}?error=task`);
  revalidatePath(`/studio/${parsed.data.project_id}`);
}

export async function decideVideoVersionAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  const parsed = z.object({
    project_id: z.string().uuid(),
    version_id: z.string().uuid(),
    decision: z.enum(["approved", "changes_requested"]),
    note: z.string().trim().max(5000),
  }).safeParse({
    project_id: value(formData, "project_id"),
    version_id: value(formData, "version_id"),
    decision: value(formData, "decision"),
    note: value(formData, "note"),
  });
  if (!parsed.success) redirect("/studio?error=validation");

  const { error } = await context.supabase.rpc("approve_video_version", {
    target_version: parsed.data.version_id,
    decision: parsed.data.decision,
    decision_note: parsed.data.note,
  });
  if (error) redirect(`/studio/${parsed.data.project_id}?error=decision`);
  revalidatePath(`/studio/${parsed.data.project_id}`);
  revalidatePath("/studio");
}

export async function releaseVersionForClientReviewAction(formData: FormData) {
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");
  if (!roleAllowed(context.role, ["super_admin", "agency_manager"])) redirect("/studio?error=forbidden");

  const parsed = z.object({ project_id: z.string().uuid() }).safeParse({ project_id: value(formData, "project_id") });
  if (!parsed.success) redirect("/studio?error=validation");

  const { error } = await context.supabase.rpc("release_project_for_client_review", { target_project: parsed.data.project_id });
  if (error) redirect(`/studio/${parsed.data.project_id}?error=transition`);
  revalidatePath(`/studio/${parsed.data.project_id}`);
  revalidatePath("/studio");
  redirect(`/studio/${parsed.data.project_id}?released=1`);
}
