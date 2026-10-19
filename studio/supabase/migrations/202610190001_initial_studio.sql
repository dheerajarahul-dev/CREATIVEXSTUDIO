create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

do $$ begin
  create type public.workspace_role as enum ('super_admin', 'agency_manager', 'video_editor', 'client', 'external_reviewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_status as enum ('draft', 'submitted', 'under_review', 'awaiting_information', 'accepted', 'declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum ('awaiting_assignment', 'assets_collecting', 'ready_for_editing', 'in_production', 'internal_review', 'client_review', 'revisions_requested', 'final_approval', 'delivery', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'blocked', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_path text,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 100)
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint workspaces_name_length check (char_length(name) between 2 and 120),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_memberships_user_idx on public.workspace_memberships(user_id, status);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null,
  auth_user_id uuid references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workspace_invitations_email_lower check (email = lower(email)),
  constraint workspace_invitations_unique unique (workspace_id, email)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  company_name text not null,
  primary_email text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, user_id)
);
create index if not exists clients_user_idx on public.clients(user_id) where user_id is not null;

create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  project_type text not null,
  brief jsonb not null default '{}'::jsonb,
  status public.request_status not null default 'submitted',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_title_length check (char_length(title) between 2 and 180),
  constraint request_brief_object check (jsonb_typeof(brief) = 'object'),
  constraint project_requests_client_fk foreign key (workspace_id, client_id) references public.clients(workspace_id, id)
);
create index if not exists project_requests_workspace_status_idx on public.project_requests(workspace_id, status, created_at desc);
create index if not exists project_requests_requester_idx on public.project_requests(requested_by, created_at desc);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid unique references public.project_requests(id) on delete set null,
  client_id uuid,
  title text not null,
  brief jsonb not null default '{}'::jsonb,
  status public.project_status not null default 'awaiting_assignment',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  manager_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  start_at timestamptz,
  due_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_title_length check (char_length(title) between 2 and 180),
  constraint projects_brief_object check (jsonb_typeof(brief) = 'object'),
  constraint projects_client_fk foreign key (workspace_id, client_id) references public.clients(workspace_id, id)
);
create index if not exists projects_workspace_status_due_idx on public.projects(workspace_id, status, due_at);
create index if not exists projects_manager_idx on public.projects(manager_id, status);

create table if not exists public.project_memberships (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null check (role in ('agency_manager', 'video_editor', 'client', 'external_reviewer')),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_memberships_user_idx on public.project_memberships(user_id, status);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text not null default '',
  status public.task_status not null default 'todo',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_length check (char_length(title) between 1 and 180)
);
create index if not exists tasks_project_status_due_idx on public.tasks(project_id, status, due_at);
create index if not exists tasks_assignee_status_due_idx on public.tasks(assignee_id, status, due_at);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text,
  category text not null default 'misc',
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_assets_name_length check (char_length(original_name) between 1 and 255),
  constraint media_assets_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index if not exists media_assets_project_created_idx on public.media_assets(project_id, created_at desc) where deleted_at is null;
create index if not exists media_assets_workspace_category_idx on public.media_assets(workspace_id, category) where deleted_at is null;

create table if not exists public.video_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.media_assets(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  label text not null default 'Work in progress',
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'in_review', 'changes_requested', 'resubmitted', 'approved', 'superseded', 'archived')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);
create index if not exists video_versions_project_idx on public.video_versions(project_id, version_number desc);

create table if not exists public.review_comments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.video_versions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  time_seconds numeric(12,3) not null check (time_seconds >= 0),
  end_time_seconds numeric(12,3),
  parent_id uuid references public.review_comments(id) on delete cascade,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_comment_time_range check (end_time_seconds is null or end_time_seconds >= time_seconds),
  constraint review_comment_body_length check (char_length(body) between 1 and 5000)
);
create index if not exists review_comments_version_time_idx on public.review_comments(version_id, time_seconds, created_at);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid not null references public.video_versions(id) on delete restrict,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text not null default '',
  decided_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists approvals_project_created_idx on public.approvals(project_id, created_at desc);

create table if not exists public.project_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_events_details_object check (jsonb_typeof(details) = 'object')
);
create index if not exists project_events_workspace_created_idx on public.project_events(workspace_id, created_at desc);
create index if not exists project_events_project_created_idx on public.project_events(project_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_key text not null,
  title text not null,
  body text not null default '',
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create or replace function private.current_workspace_role(target_workspace uuid)
returns public.workspace_role
language sql stable security definer
set search_path = ''
as $$
  select membership.role
  from public.workspace_memberships as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.workspace_id = target_workspace
    and membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and profile.is_suspended = false
  limit 1
$$;

create or replace function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.current_workspace_role(target_workspace) is not null $$;

create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select target_user = (select auth.uid()) or exists (
    select 1 from public.workspace_memberships as mine
    join public.workspace_memberships as theirs on theirs.workspace_id = mine.workspace_id
    join public.profiles as profile on profile.id = theirs.user_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = target_user and theirs.status = 'active' and profile.is_suspended = false
  )
$$;

create or replace function private.can_access_project(target_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    where project.id = target_project
      and (
        private.current_workspace_role(project.workspace_id) in ('super_admin', 'agency_manager')
        or exists (select 1 from public.clients as client where client.id = project.client_id and client.user_id = (select auth.uid()))
        or exists (select 1 from public.project_memberships as member where member.project_id = project.id and member.user_id = (select auth.uid()) and member.status = 'active')
      )
  )
$$;

create or replace function private.can_manage_workspace(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.current_workspace_role(target_workspace) in ('super_admin', 'agency_manager') $$;

create or replace function private.can_upload_project(target_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    where project.id = target_project and private.can_access_project(project.id)
      and (
        private.current_workspace_role(project.workspace_id) in ('super_admin', 'agency_manager', 'video_editor')
        or exists (select 1 from public.clients as client where client.id = project.client_id and client.user_id = (select auth.uid()))
      )
  )
$$;

revoke all on function private.current_workspace_role(uuid) from public, anon;
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.can_view_profile(uuid) from public, anon;
revoke all on function private.can_access_project(uuid) from public, anon;
revoke all on function private.can_manage_workspace(uuid) from public, anon;
revoke all on function private.can_upload_project(uuid) from public, anon;
grant execute on function private.current_workspace_role(uuid) to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_access_project(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;
grant execute on function private.can_upload_project(uuid) to authenticated;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 100), split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end
$$;
revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create or replace function public.accept_workspace_invitation()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare invite public.workspace_invitations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into invite from public.workspace_invitations
  where auth_user_id = (select auth.uid()) and email = lower((select auth.jwt() ->> 'email'))
    and accepted_at is null and expires_at > now()
  for update;
  if not found then raise exception 'No valid invitation'; end if;
  insert into public.workspace_memberships (workspace_id, user_id, role, status, invited_by)
  values (invite.workspace_id, (select auth.uid()), invite.role, 'active', invite.invited_by)
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
  update public.workspace_invitations set accepted_at = now() where id = invite.id;
end
$$;
revoke all on function public.accept_workspace_invitation() from public, anon;
grant execute on function public.accept_workspace_invitation() to authenticated;

create or replace function public.accept_project_request(target_request uuid, assigned_editor uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare request_row public.project_requests%rowtype; new_project uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into request_row from public.project_requests where id = target_request for update;
  if not found or not private.can_manage_workspace(request_row.workspace_id) then raise exception 'Request unavailable'; end if;
  if request_row.status not in ('submitted', 'under_review', 'awaiting_information') then raise exception 'Request is not eligible for acceptance'; end if;
  if assigned_editor is not null and not exists (
    select 1 from public.workspace_memberships
    where workspace_id = request_row.workspace_id and user_id = assigned_editor
      and role = 'video_editor' and status = 'active'
  ) then raise exception 'Editor is not an active workspace editor'; end if;

  insert into public.projects (workspace_id, request_id, client_id, title, brief, status, manager_id, created_by)
  values (request_row.workspace_id, request_row.id, request_row.client_id, request_row.title, request_row.brief,
    case when assigned_editor is null then 'awaiting_assignment'::public.project_status else 'ready_for_editing'::public.project_status end,
    (select auth.uid()), (select auth.uid()))
  returning id into new_project;

  if assigned_editor is not null then
    insert into public.project_memberships (project_id, user_id, role, assigned_by)
    values (new_project, assigned_editor, 'video_editor', (select auth.uid()));
  end if;
  update public.project_requests set status = 'accepted', reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
  where id = request_row.id;
  insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
  values (request_row.workspace_id, new_project, (select auth.uid()), 'project.created_from_request', jsonb_build_object('request_id', request_row.id));
  return new_project;
end
$$;
revoke all on function public.accept_project_request(uuid, uuid) from public, anon;
grant execute on function public.accept_project_request(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.clients enable row level security;
alter table public.project_requests enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.tasks enable row level security;
alter table public.media_assets enable row level security;
alter table public.video_versions enable row level security;
alter table public.review_comments enable row level security;
alter table public.approvals enable row level security;
alter table public.project_events enable row level security;
alter table public.notifications enable row level security;

revoke all on public.profiles, public.workspaces, public.workspace_memberships, public.workspace_invitations,
  public.clients, public.project_requests, public.projects, public.project_memberships, public.tasks,
  public.media_assets, public.video_versions, public.review_comments, public.approvals,
  public.project_events, public.notifications from anon, authenticated;
grant select on public.profiles, public.workspaces, public.workspace_memberships, public.clients,
  public.project_requests, public.projects, public.project_memberships, public.tasks, public.media_assets,
  public.video_versions, public.review_comments, public.approvals, public.project_events, public.notifications to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;
grant insert (workspace_id, user_id, company_name, primary_email) on public.clients to authenticated;
grant insert (workspace_id, project_id, parent_id, title, description, status, priority, assignee_id, due_at, created_by) on public.tasks to authenticated;
grant insert (workspace_id, project_id, asset_id, version_number, label, notes, status, submitted_by, submitted_at) on public.video_versions to authenticated;
grant update (label, notes, status, submitted_at) on public.video_versions to authenticated;
grant insert (workspace_id, client_id, requested_by, title, project_type, brief) on public.project_requests to authenticated;
grant update (status, reviewed_by, reviewed_at, decline_reason, updated_at) on public.project_requests to authenticated;
grant update (status, completed_at, updated_at) on public.tasks to authenticated;
grant insert (workspace_id, project_id, storage_path, original_name, mime_type, byte_size, sha256, category, metadata, uploaded_by) on public.media_assets to authenticated;
grant insert (version_id, project_id, author_id, body, time_seconds, end_time_seconds, parent_id) on public.review_comments to authenticated;
grant update (body, resolved_at, resolved_by, updated_at) on public.review_comments to authenticated;
grant insert (project_id, version_id, decision, note, decided_by) on public.approvals to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy profiles_read_shared_workspace on public.profiles for select to authenticated using ((select private.can_view_profile(id)));
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy workspaces_read_member on public.workspaces for select to authenticated using ((select private.is_workspace_member(id)));
create policy memberships_read_workspace on public.workspace_memberships for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy invitations_read_admin on public.workspace_invitations for select to authenticated using ((select private.current_workspace_role(workspace_id)) = 'super_admin');
create policy clients_read_self_or_managed on public.clients for select to authenticated using (user_id = (select auth.uid()) or (select private.can_manage_workspace(workspace_id)));
create policy clients_insert_managers on public.clients for insert to authenticated with check ((select private.can_manage_workspace(workspace_id)));
create policy clients_insert_self on public.clients for insert to authenticated with check (user_id = (select auth.uid()) and (select private.current_workspace_role(workspace_id)) = 'client');
create policy clients_update_managers on public.clients for update to authenticated using ((select private.can_manage_workspace(workspace_id))) with check ((select private.can_manage_workspace(workspace_id)));
create policy requests_read_owner_or_staff on public.project_requests for select to authenticated using (requested_by = (select auth.uid()) or (select private.can_manage_workspace(workspace_id)));
create policy requests_insert_client on public.project_requests for insert to authenticated with check (
  requested_by = (select auth.uid())
  and (select private.current_workspace_role(workspace_id)) = 'client'
  and exists (select 1 from public.clients where id = client_id and workspace_id = project_requests.workspace_id and user_id = (select auth.uid()))
);
create policy requests_update_staff on public.project_requests for update to authenticated using ((select private.can_manage_workspace(workspace_id))) with check ((select private.can_manage_workspace(workspace_id)));
create policy projects_read_assigned on public.projects for select to authenticated using ((select private.can_access_project(id)));
create policy projects_insert_managers on public.projects for insert to authenticated with check ((select private.can_manage_workspace(workspace_id)) and created_by = (select auth.uid()));
create policy projects_update_managers on public.projects for update to authenticated using ((select private.can_manage_workspace(workspace_id))) with check ((select private.can_manage_workspace(workspace_id)));
create policy project_members_read_project on public.project_memberships for select to authenticated using ((select private.can_access_project(project_id)));
create policy tasks_read_project on public.tasks for select to authenticated using ((select private.can_access_project(project_id)));
create policy tasks_insert_managers on public.tasks for insert to authenticated with check ((select private.can_manage_workspace(workspace_id)) and exists (select 1 from public.projects where id = project_id and workspace_id = tasks.workspace_id));
create policy tasks_update_assignee_or_manager on public.tasks for update to authenticated using (assignee_id = (select auth.uid()) or (select private.can_manage_workspace(workspace_id))) with check (assignee_id = (select auth.uid()) or (select private.can_manage_workspace(workspace_id)));
create policy assets_read_project on public.media_assets for select to authenticated using ((select private.can_access_project(project_id)) and deleted_at is null);
create policy assets_insert_project on public.media_assets for insert to authenticated with check (uploaded_by = (select auth.uid()) and (select private.can_upload_project(project_id)) and exists (select 1 from public.projects where id = project_id and workspace_id = media_assets.workspace_id));
create policy versions_read_project on public.video_versions for select to authenticated using ((select private.can_access_project(project_id)));
create policy versions_insert_assigned_editor on public.video_versions for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.can_upload_project(project_id))
  and exists (select 1 from public.projects where id = project_id and workspace_id = video_versions.workspace_id)
  and exists (select 1 from public.media_assets where id = asset_id and project_id = video_versions.project_id and workspace_id = video_versions.workspace_id)
);
create policy versions_update_assigned_editor on public.video_versions for update to authenticated
using ((select private.can_upload_project(project_id)) and status in ('draft', 'changes_requested'))
with check ((select private.can_upload_project(project_id)) and status in ('draft', 'submitted', 'changes_requested', 'resubmitted'));
create policy comments_read_project on public.review_comments for select to authenticated using ((select private.can_access_project(project_id)));
create policy comments_insert_project on public.review_comments for insert to authenticated with check (author_id = (select auth.uid()) and (select private.can_access_project(project_id)) and exists (select 1 from public.video_versions where id = version_id and project_id = review_comments.project_id));
create policy comments_update_author_or_manager on public.review_comments for update to authenticated using (author_id = (select auth.uid()) or exists (select 1 from public.projects where id = project_id and (select private.can_manage_workspace(workspace_id)))) with check (author_id = (select auth.uid()) or exists (select 1 from public.projects where id = project_id and (select private.can_manage_workspace(workspace_id))));
create policy approvals_read_project on public.approvals for select to authenticated using ((select private.can_access_project(project_id)));
create policy approvals_insert_client_or_manager on public.approvals for insert to authenticated with check (decided_by = (select auth.uid()) and exists (select 1 from public.projects as project join public.clients as client on client.id = project.client_id where project.id = approvals.project_id and client.user_id = (select auth.uid())) and exists (select 1 from public.video_versions where id = version_id and project_id = approvals.project_id and status in ('submitted', 'in_review', 'resubmitted')));
create policy events_read_project on public.project_events for select to authenticated using ((project_id is not null and (select private.can_access_project(project_id))) or (project_id is null and (select private.is_workspace_member(workspace_id))));
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = (select auth.uid()) and (select private.is_workspace_member(workspace_id)));
create policy notifications_update_own on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.workspace_memberships, public.workspace_invitations, public.projects,
  public.project_memberships, public.video_versions, public.approvals, public.project_events, public.notifications from authenticated;
revoke update, delete on public.project_events from authenticated;
revoke delete on all tables in schema public from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('CREATIVEXSTUDIO', 'CREATIVEXSTUDIO', false, 5368709120,
  array['video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','image/jpeg','image/png','image/webp','application/pdf','text/plain','application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy studio_private_read_project on storage.objects for select to authenticated using (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1] and private.can_access_project(project.id)
  )
);
create policy studio_private_insert_project on storage.objects for insert to authenticated with check (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1] and private.can_upload_project(project.id)
  )
);
create policy studio_private_delete_manager on storage.objects for delete to authenticated using (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1] and private.can_manage_workspace(project.workspace_id)
  )
);
