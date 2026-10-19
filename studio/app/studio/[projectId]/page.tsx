import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext, roleAllowed } from "@/lib/authz";
import { getStorageBucketName, getSupabaseEnvironment } from "@/lib/supabase/env";
import { createProjectTaskAction, downloadProjectAssetAction, releaseVersionForClientReviewAction, submitVideoVersionAction, updateTaskStatusAction } from "../actions";
import AssetUploader from "../asset-uploader";
import ReviewStudio from "../review-studio";

const statusLabels: Record<string, string> = {
  awaiting_assignment: "Awaiting assignment", assets_collecting: "Collecting assets", ready_for_editing: "Ready for editing",
  in_production: "In production", internal_review: "Internal review", client_review: "Client review",
  revisions_requested: "Revisions requested", final_approval: "Final approval", delivery: "Delivery", completed: "Completed", archived: "Archived",
};

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ version?: string; versionSubmitted?: string; released?: string; error?: string }> };

export default function ProjectPage(props: Props) {
  return <Suspense fallback={<main className="secure-shell"><div className="secure-loading">Loading project workspace…</div></main>}><ProjectContent {...props} /></Suspense>;
}

async function ProjectContent({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (!getSupabaseEnvironment()) return <SetupRequired />;
  const context = await getAuthContext();
  if (!context) redirect(`/login?next=${encodeURIComponent(`/studio/${projectId}`)}`);

  const { data: project, error: projectError } = await context.supabase.from("projects")
    .select("id, workspace_id, client_id, title, brief, status, priority, due_at, start_at, created_at, updated_at, clients(company_name)")
    .eq("id", projectId).eq("workspace_id", context.workspaceId).maybeSingle();
  if (projectError || !project) notFound();

  const [assetsResult, versionsResult, tasksResult, membersResult, eventsResult] = await Promise.all([
    context.supabase.from("media_assets").select("id, storage_path, original_name, mime_type, byte_size, category, uploaded_by, created_at").eq("project_id", projectId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    context.supabase.from("video_versions").select("id, asset_id, version_number, label, notes, status, submitted_by, submitted_at, created_at").eq("project_id", projectId).order("version_number", { ascending: false }).limit(50),
    context.supabase.from("tasks").select("id, title, description, status, priority, assignee_id, due_at, created_at").eq("project_id", projectId).order("due_at", { ascending: true, nullsFirst: false }).limit(100),
    context.supabase.from("project_memberships").select("user_id, role").eq("project_id", projectId).eq("status", "active").limit(50),
    context.supabase.from("project_events").select("id, actor_id, event_type, details, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(12),
  ]);
  const assets = assetsResult.data ?? [];
  const versions = versionsResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const team = membersResult.data ?? [];
  const version = versions.find((item) => item.id === query.version) ?? versions[0] ?? null;
  const selectedAsset = version ? assets.find((asset) => asset.id === version.asset_id) : null;
  const [{ data: comments }, { data: profiles }, signedResult] = await Promise.all([
    version ? context.supabase.from("review_comments").select("id, body, time_seconds, created_at, author_id, resolved_at").eq("version_id", version.id).order("time_seconds", { ascending: true }).limit(300) : Promise.resolve({ data: [] as never[] }),
    context.supabase.from("profiles").select("id, display_name").in("id", [...new Set([...(team.map((member) => member.user_id)), ...(version ? [version.submitted_by] : [])])].slice(0, 100)),
    selectedAsset ? context.supabase.storage.from(getStorageBucketName()).createSignedUrl(selectedAsset.storage_path, 900) : Promise.resolve({ data: null, error: null }),
  ]);
  const people = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
  const reviewComments = (comments ?? []).map((comment) => ({ ...comment, author: people.get(comment.author_id) || "Workspace member" }));
  const videoUrl = selectedAsset?.mime_type.startsWith("video/") ? signedResult.data?.signedUrl ?? null : null;
  const canManage = roleAllowed(context.role, ["super_admin", "agency_manager"]);
  const canEdit = roleAllowed(context.role, ["super_admin", "agency_manager", "video_editor"]);
  const canUpload = roleAllowed(context.role, ["super_admin", "agency_manager", "video_editor", "client"]);
  const canApprove = roleAllowed(context.role, ["client", "external_reviewer"]);
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const taskProgress = tasks.length ? Math.round(completedTasks / tasks.length * 100) : 0;
  const company = relationName(project.clients);
  const brief = asBrief(project.brief);
  const eventProfiles = await context.supabase.from("profiles").select("id, display_name").in("id", [...new Set((eventsResult.data ?? []).map((event) => event.actor_id).filter(Boolean))].slice(0, 100));
  const eventPeople = new Map((eventProfiles.data ?? []).map((profile) => [profile.id, profile.display_name]));

  const errorText = query.error === "version" ? "The video version could not be submitted. Confirm project assignment and try again."
    : query.error === "comment" ? "The review note could not be saved to this version."
      : query.error === "task" ? "Task update failed. Your role may not have permission to change it."
        : query.error === "decision" ? "This version is no longer awaiting approval, or your account cannot approve it."
          : query.error === "transition" ? "The project is no longer ready for that workflow transition. Refresh and try again."
            : "";

  return <section className="project-detail-content"><nav className="project-breadcrumb"><Link href="/studio">Workspace</Link><span>/</span><span>{company}</span><span>/</span><strong>{project.title}</strong></nav>
      {errorText && <p className="secure-notice" role="alert">{errorText}</p>}{query.versionSubmitted && <p className="secure-success" role="status">Your version has been saved and the review status updated.</p>}{query.released && <p className="secure-success" role="status">The version is now available for client review.</p>}
      <header className="project-detail-header"><div><span className="eyebrow">PROJECT WORKSPACE · {company.toUpperCase()}</span><h1>{project.title}</h1><p>{brief.description || "Production brief and deliverables for this project."}</p></div><div className="project-detail-actions"><span className={`project-state state-${project.status}`}>{statusLabels[project.status] ?? project.status.replaceAll("_", " ")}</span>{canManage && project.status === "internal_review" && <form action={releaseVersionForClientReviewAction}><input type="hidden" name="project_id" value={project.id} /><button className="button button-primary">Release to client review ↗</button></form>}</div></header>
      <section className="project-facts"><Fact label="CLIENT" value={company} /><Fact label="PRIORITY" value={project.priority} /><Fact label="DEADLINE" value={project.due_at ? formatDate(project.due_at) : "Not set"} /><Fact label="TASKS COMPLETE" value={`${completedTasks} / ${tasks.length}`} /><div className="project-progress-fact"><span>PRODUCTION PROGRESS</span><b>{taskProgress}%</b><i><em style={{ width: `${taskProgress}%` }} /></i></div></section>

      <div className="project-work-grid"><div className="project-work-main">
        <section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">CUTS & APPROVALS</span><h2>Review room</h2></div><span>{versions.length} version{versions.length === 1 ? "" : "s"}</span></div>
          {versions.length > 0 && <nav className="version-tabs" aria-label="Video versions">{versions.map((item) => <Link key={item.id} className={item.id === version?.id ? "selected" : ""} href={`/studio/${projectId}?version=${item.id}`}>V{String(item.version_number).padStart(2, "2")} <small>{item.status.replaceAll("_", " ")}</small></Link>)}</nav>}
          {version ? <ReviewStudio projectId={projectId} version={{ id: version.id, label: version.label, notes: version.notes, version_number: version.version_number, status: version.status, submitted_at: version.submitted_at }} videoUrl={videoUrl} comments={reviewComments} canApprove={canApprove} /> : <div className="project-empty-review"><span>▶</span><strong>No cut submitted yet</strong><p>Editors can upload a video asset and create the first version for this project.</p></div>}
        </section>

        <section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">PROJECT FILES</span><h2>Media & assets</h2></div><span>{assets.length} file{assets.length === 1 ? "" : "s"}</span></div>
          {canUpload && <AssetUploader projectId={projectId} />}
          {assets.length > 0 ? <div className="project-assets-list">{assets.map((asset) => <AssetRow key={asset.id} asset={asset} projectId={projectId} />)}</div> : <div className="project-empty-inline">No media uploaded yet. Project files remain private to assigned members.</div>}
          {canEdit && assets.some((asset) => asset.mime_type.startsWith("video/")) && <form action={submitVideoVersionAction} className="version-submit-form"><div><span className="eyebrow">EDITOR WORKFLOW</span><h3>Submit a new cut</h3></div><input type="hidden" name="project_id" value={projectId} /><label>Video file<select name="asset_id" required defaultValue=""><option value="" disabled>Select a video asset</option>{assets.filter((asset) => asset.mime_type.startsWith("video/")).map((asset) => <option key={asset.id} value={asset.id}>{asset.original_name}</option>)}</select></label><label>Version label<input name="label" maxLength={120} required defaultValue={`Cut ${versions.length + 1}`} /></label><label>Version notes<textarea name="notes" rows={2} maxLength={5000} placeholder="What changed in this version?" /></label><label className="submit-review-toggle"><input type="checkbox" name="submit_for_review" value="yes" defaultChecked /> Submit for internal review</label><button className="button button-primary">Create version ↗</button></form>}
        </section>
      </div>

      <aside className="project-work-aside"><section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">PRODUCTION CHECKLIST</span><h2>Tasks</h2></div><span>{completedTasks}/{tasks.length}</span></div><div className="project-task-list">{tasks.map((task) => <article className="project-task" key={task.id}><div className={`task-status-icon task-${task.status}`}>{task.status === "completed" ? "✓" : task.status === "blocked" ? "!" : "·"}</div><div className="project-task-copy"><strong>{task.title}</strong><small>{task.assignee_id ? `Assigned · ${people.get(task.assignee_id) || "Project member"}` : "Unassigned"}{task.due_at ? ` · Due ${formatDate(task.due_at)}` : ""}</small></div>{canManage || task.assignee_id === context.user.id ? <form action={updateTaskStatusAction}><input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="task_id" value={task.id} /><button className="task-action" name="status" value={task.status === "completed" ? "todo" : "completed"} aria-label={task.status === "completed" ? `Reopen ${task.title}` : `Complete ${task.title}`}>{task.status === "completed" ? "↺" : "✓"}</button></form> : <span className="task-status-label">{task.status.replaceAll("_", " ")}</span>}</article>)}{tasks.length === 0 && <p className="project-empty-inline">No tasks have been added yet.</p>}</div></section>
        <section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">PROJECT TEAM</span><h2>Collaborators</h2></div><span>{team.length}</span></div><div className="project-team-list">{team.map((member) => <div key={member.user_id}><span className="project-team-avatar">{String(people.get(member.user_id) || "CX").split(" ").map((part: string) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><strong>{people.get(member.user_id) || "Project collaborator"}</strong><small>{member.role.replaceAll("_", " ")}</small></span></div>)}<div><span className="project-team-avatar">{context.profile.display_name.split(" ").map((part: string) => part[0]).slice(0, 2).join("").toUpperCase() || "CX"}</span><span><strong>{context.profile.display_name || context.user.email}</strong><small>{context.role.replaceAll("_", " ")} · You</small></span></div></div></section>
        <section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">RECENT CHANGES</span><h2>Activity</h2></div><span>{eventsResult.data?.length ?? 0}</span></div><div className="project-activity">{(eventsResult.data ?? []).map((event) => <article key={event.id}><i /><div><strong>{event.event_type.replaceAll(".", " ").replaceAll("_", " ")}</strong><small>{event.actor_id ? eventPeople.get(event.actor_id) || "Workspace member" : "System"} · {relativeDate(event.created_at)}</small></div></article>)}{!eventsResult.data?.length && <p className="project-empty-inline">Project activity will appear here as work moves forward.</p>}</div></section>
      </aside></div>
      {canManage && <section className="secure-section project-section"><div className="secure-section-heading"><div><span className="eyebrow">TEAM PLANNING</span><h2>Add a production task</h2></div></div><form action={createProjectTaskAction} className="task-create-form"><input type="hidden" name="project_id" value={projectId} /><label>Task title<input name="title" minLength={2} maxLength={180} placeholder="e.g. Prepare first cut" required /></label><label>Due date<input name="due_at" type="datetime-local" /></label><button className="button button-primary">Create task</button></form></section>}
    </section>;
}

function relationName(value: unknown): string {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "company_name" in value && typeof value.company_name === "string") return value.company_name;
  return "Client workspace";
}

function asBrief(value: unknown): { description?: string } {
  return value && typeof value === "object" && "description" in value && typeof value.description === "string" ? { description: value.description } : {};
}

function formatDate(value: string) { return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function relativeDate(value: string) { const hours = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 3600000)); return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`; }

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function AssetRow({ asset, projectId }: { asset: { id: string; original_name: string; mime_type: string; byte_size: number; category: string; created_at: string }; projectId: string }) {
  const size = asset.byte_size > 1024 ** 3 ? `${(asset.byte_size / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(asset.byte_size / 1024 ** 2))} MB`;
  return <div className="project-asset-row"><span className={`asset-kind ${asset.mime_type.startsWith("video/") ? "asset-video" : ""}`}>{asset.mime_type.startsWith("video/") ? "▶" : asset.mime_type.startsWith("image/") ? "◫" : "▤"}</span><span className="project-asset-copy"><strong>{asset.original_name}</strong><small>{asset.category.replaceAll("_", " ")} · {size} · {formatDate(asset.created_at)}</small></span><form action={downloadProjectAssetAction}><input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="asset_id" value={asset.id} /><button className="asset-download">Download ↗</button></form></div>;
}

function SetupRequired() { return <main className="setup-required"><span className="brand-mark">CX</span><span className="eyebrow">PRODUCTION SETUP REQUIRED</span><h1>Connect your workspace.</h1><p>Supabase Auth and database are not configured. Add your project URL and publishable key to the environment, then apply the migrations.</p><Link className="button button-primary" href="/login">Go to sign in</Link></main>; }
