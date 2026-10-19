import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptProjectRequestAction, createProjectRequestAction } from "./actions";
import InviteForm from "./invite-form";
import { getAuthContext, roleAllowed } from "@/lib/authz";
import { getSupabaseEnvironment } from "@/lib/supabase/env";

const statusLabels: Record<string, string> = {
  awaiting_assignment: "Awaiting assignment", assets_collecting: "Collecting assets", ready_for_editing: "Ready for editing",
  in_production: "In production", internal_review: "Internal review", client_review: "Client review",
  revisions_requested: "Revisions requested", final_approval: "Final approval", delivery: "Delivery", completed: "Completed", archived: "Archived",
};

type StudioPageProps = { searchParams: Promise<{ error?: string; submitted?: string; accepted?: string; q?: string; status?: string }> };

export default function StudioPage({ searchParams }: StudioPageProps) {
  return <Suspense fallback={<main className="secure-shell"><div className="secure-loading">Loading private workspace…</div></main>}><StudioContent searchParams={searchParams} /></Suspense>;
}

async function StudioContent({ searchParams }: StudioPageProps) {
  await cookies();
  const params = await searchParams;
  if (!getSupabaseEnvironment()) return <SetupRequired />;
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  const search = (params.q ?? "").trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
  const overdueFilter = params.status === "overdue";
  const statusFilter = ["awaiting_assignment", "assets_collecting", "ready_for_editing", "in_production", "internal_review", "client_review", "revisions_requested", "final_approval", "delivery", "completed"].includes(params.status ?? "") ? params.status : null;
  let projectQuery = context.supabase
    .from("projects")
    .select("id, title, status, priority, due_at, updated_at, clients(company_name)")
    .eq("workspace_id", context.workspaceId)
    .neq("status", "archived")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (search) projectQuery = projectQuery.ilike("title", `%${search}%`);
  if (statusFilter) projectQuery = projectQuery.eq("status", statusFilter);
  if (overdueFilter) projectQuery = projectQuery.lt("due_at", new Date().toISOString()).not("status", "in", "(completed,archived)");
  const { data: projects, error: projectsError } = await projectQuery;

  const canManage = roleAllowed(context.role, ["super_admin", "agency_manager"]);
  const { data: requests, error: requestsError } = canManage
    ? await context.supabase.from("project_requests").select("id, title, project_type, status, created_at, brief, clients(company_name)").eq("workspace_id", context.workspaceId).in("status", ["submitted", "under_review", "awaiting_information"]).order("created_at", { ascending: true }).limit(50)
    : { data: [], error: null };
  const { data: editors } = canManage
    ? await context.supabase.from("workspace_memberships").select("user_id, profiles(display_name)").eq("workspace_id", context.workspaceId).eq("role", "video_editor").eq("status", "active").limit(100)
    : { data: [] };
  const [{ count: activeCount }, { count: reviewCount }, { count: overdueCount }] = await Promise.all([
    context.supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).neq("status", "archived").neq("status", "completed"),
    context.supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).eq("status", "client_review"),
    context.supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).lt("due_at", new Date().toISOString()).not("status", "in", "(completed,archived)"),
  ]);
  const greeting = context.profile.display_name || context.user.email?.split("@")[0] || "there";
  const pageError = params.error === "forbidden" ? "Your workspace role cannot perform that action."
    : params.error === "validation" ? "Check the required fields and try again."
      : params.error === "transition" ? "This request could not be converted. Refresh the list and try again."
        : params.error === "save" ? "We could not save that request. Please try again."
          : projectsError || requestsError ? "Some workspace data could not be loaded. Refresh or contact your administrator." : "";

  return <section className="secure-content"><div className="secure-heading"><div><span className="eyebrow">{context.role === "client" ? "CLIENT WORKSPACE" : context.role === "video_editor" ? "EDITOR WORKSPACE" : "AGENCY OPERATIONS"}</span><h1>Good work, {greeting}.</h1><p>{context.role === "client" ? "Track your projects, share a brief, and review work when it is ready." : context.role === "video_editor" ? "Your assigned projects and production work, in one place." : "Live workspace data, scoped to your authorized team."}</p></div><span className="secure-workspace-tag">PRIVATE WORKSPACE</span></div>
      {pageError && <p className="secure-notice" role="alert">{pageError}</p>}{params.submitted && <p className="secure-success" role="status">Your project request was submitted to the agency.</p>}{params.accepted && <p className="secure-success" role="status">The request was accepted and converted into a project.</p>}
      <div className="secure-metrics"><Link href="/studio#projects"><Metric label="Active projects" value={String(activeCount ?? 0)} detail="Across this workspace" /></Link><Link href="/studio?status=client_review#projects"><Metric label="Client reviews" value={String(reviewCount ?? 0)} detail="Waiting for client action" /></Link><Link href="/studio?status=overdue#projects"><Metric label="Overdue projects" value={String(overdueCount ?? 0)} detail="Past their due date" variant="warning" /></Link>{canManage && <Link href="/studio#requests"><Metric label="Intake requests" value={String(requests?.length ?? 0)} detail="Awaiting your review" variant="accent" /></Link>}</div>
      <section className="secure-section" id="projects"><div className="secure-section-heading"><div><span className="eyebrow">AUTHORIZED PROJECTS</span><h2>{canManage ? "Workspace production" : "Your projects"}</h2></div><span>{projects?.length ?? 0} shown</span></div><form className="project-filter-bar" action="/studio"><label className="studio-filter-search">⌕<input type="search" name="q" maxLength={100} placeholder="Find a project by name" defaultValue={params.q ?? ""} /></label><select name="status" defaultValue={overdueFilter ? "overdue" : statusFilter ?? "all"}><option value="all">All statuses</option><option value="overdue">Overdue</option>{Object.entries(statusLabels).filter(([status]) => status !== "archived").map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select><button className="button button-outline">Filter projects</button></form>{projectsError ? <p className="secure-empty">Projects are unavailable. Verify the database migration and workspace membership.</p> : projects?.length ? <div className="secure-table-wrap"><table className="secure-table"><thead><tr><th>PROJECT</th>{canManage && <th>CLIENT</th>}<th>STATUS</th><th>PRIORITY</th><th>DEADLINE</th><th /></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><Link className="project-table-link" href={`/studio/${project.id}`}><strong>{project.title}</strong><small>Updated {new Date(project.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</small></Link></td>{canManage && <td>{relationName(project.clients)}</td>}<td><span className={`secure-status status-${project.status}`}>{statusLabels[project.status] ?? project.status}</span></td><td><span className={`priority-pill priority-${project.priority}`}>{project.priority}</span></td><td>{project.due_at ? new Date(project.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "Not set"}</td><td><Link className="project-row-open" href={`/studio/${project.id}`} aria-label={`Open ${project.title}`}>↗</Link></td></tr>)}</tbody></table></div> : <p className="secure-empty">{params.q || statusFilter || overdueFilter ? "No projects match these filters." : "No active projects are assigned to this workspace yet."}</p>}</section>
      {canManage && <section className="secure-section" id="requests"><div className="secure-section-heading"><div><span className="eyebrow">CLIENT INTAKE</span><h2>Requests awaiting review</h2></div><span>{requests?.length ?? 0} open</span></div>{requestsError ? <p className="secure-empty">Requests are unavailable. Verify database policies.</p> : requests?.length ? <div className="request-list">{requests.map((request) => <article className="request-card" key={request.id}><div className="request-meta"><div><strong>{request.title}</strong><small>{relationName(request.clients)} · {request.project_type} · {new Date(request.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</small></div><span className="secure-status">{request.status.replaceAll("_", " ")}</span></div><p>{briefDescription(request.brief)}</p><form action={acceptProjectRequestAction} className="request-action"><input type="hidden" name="request_id" value={request.id} /><label>Assign editor<select name="editor_id"><option value="">Leave unassigned</option>{(editors ?? []).map((editor) => <option key={editor.user_id} value={editor.user_id}>{relationName(editor.profiles)}</option>)}</select></label><button className="button button-primary">Accept & create project</button></form></article>)}</div> : <p className="secure-empty">No client requests are waiting for review.</p>}</section>}
      {context.role === "client" && <section className="secure-section"><div className="secure-section-heading"><div><span className="eyebrow">NEW WORK</span><h2>Submit a project request</h2></div></div><form action={createProjectRequestAction} className="secure-form"><label>Project title<input name="title" maxLength={180} required /></label><label>Project type<select name="project_type"><option>Campaign film</option><option>Brand story</option><option>YouTube / long-form</option><option>Short-form social</option><option>Post-production</option><option>Other</option></select></label><label>Company name<input name="company_name" maxLength={160} required /></label><label>Project brief<textarea name="description" minLength={10} maxLength={10000} rows={4} required placeholder="Objectives, desired outcomes, and key context" /></label><div className="secure-form-grid"><label>Target audience<input name="target_audience" maxLength={500} /></label><label>Publishing platforms<input name="platforms" maxLength={300} placeholder="Instagram, YouTube…" /></label><label>Target duration<input name="duration" maxLength={80} placeholder="e.g. 60 seconds" /></label><label>Requested deadline<input name="deadline" type="date" /></label><label>Budget range<input name="budget" maxLength={80} placeholder="Optional" /></label></div><button className="button button-primary">Submit project request</button></form></section>}
      {context.role === "super_admin" && <section className="secure-section"><div className="secure-section-heading"><div><span className="eyebrow">TEAM ACCESS</span><h2>Invite a collaborator</h2></div></div><InviteForm workspaceId={context.workspaceId} /></section>}
    </section>;
}

function relationName(value: unknown): string {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "company_name" in value && typeof value.company_name === "string") return value.company_name;
  if (value && typeof value === "object" && "display_name" in value && typeof value.display_name === "string") return value.display_name;
  return "Client workspace";
}

function briefDescription(value: unknown): string {
  if (value && typeof value === "object" && "description" in value && typeof value.description === "string") return value.description;
  return "Brief details are available in the request record.";
}

function Metric({ label, value, detail, variant = "" }: { label: string; value: string; detail: string; variant?: string }) {
  return <article className={`secure-metric ${variant}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function SetupRequired() {
  return <main className="setup-required"><span className="brand-mark">CX</span><span className="eyebrow">PRODUCTION SETUP REQUIRED</span><h1>Connect your workspace.</h1><p>Supabase Auth and the database are not configured. Copy <code>studio/.env.example</code> to <code>studio/.env.local</code>, add your Supabase project URL and publishable key, then apply the migration.</p><a className="button button-primary" href="/login">Go to sign in</a></main>;
}
