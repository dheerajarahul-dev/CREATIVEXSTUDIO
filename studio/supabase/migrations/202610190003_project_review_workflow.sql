create or replace function public.submit_video_version(
  target_project uuid,
  target_asset uuid,
  version_label text,
  version_notes text,
  submit_for_review boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_row public.projects%rowtype;
  asset_row public.media_assets%rowtype;
  next_version integer;
  new_version uuid;
  next_status text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into project_row from public.projects where id = target_project for update;
  if not found or not private.can_edit_project_version(target_project) then
    raise exception 'Project unavailable';
  end if;

  select * into asset_row from public.media_assets
  where id = target_asset and project_id = target_project
    and workspace_id = project_row.workspace_id and deleted_at is null;
  if not found or asset_row.mime_type not like 'video/%' then
    raise exception 'A valid project video asset is required';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.video_versions where project_id = target_project;
  next_status := case when submit_for_review then 'submitted' else 'draft' end;

  if submit_for_review then
    update public.video_versions set status = 'superseded'
    where project_id = target_project and status in ('submitted', 'in_review', 'resubmitted');
  end if;

  insert into public.video_versions (
    workspace_id, project_id, asset_id, version_number, label, notes,
    status, submitted_by, submitted_at
  ) values (
    project_row.workspace_id, target_project, target_asset, next_version,
    left(trim(version_label), 120), left(trim(version_notes), 5000),
    next_status, (select auth.uid()), case when submit_for_review then now() else null end
  ) returning id into new_version;

  if submit_for_review then
    update public.projects set status = 'internal_review', updated_at = now()
    where id = target_project;
  end if;

  insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
  values (project_row.workspace_id, target_project, (select auth.uid()), 'video.version_submitted',
    jsonb_build_object('version_id', new_version, 'version_number', next_version, 'status', next_status));

  return new_version;
end
$$;

revoke all on function public.submit_video_version(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.submit_video_version(uuid, uuid, text, text, boolean) to authenticated;

create or replace function public.accept_project_request(target_request uuid, assigned_editor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.project_requests%rowtype;
  new_project uuid;
  requested_date text;
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

  requested_date := request_row.brief ->> 'requested_deadline';
  insert into public.projects (workspace_id, request_id, client_id, title, brief, status, manager_id, created_by, due_at)
  values (
    request_row.workspace_id, request_row.id, request_row.client_id, request_row.title, request_row.brief,
    case when assigned_editor is null then 'awaiting_assignment'::public.project_status else 'ready_for_editing'::public.project_status end,
    (select auth.uid()), (select auth.uid()),
    case when requested_date ~ '^\d{4}-\d{2}-\d{2}$' then requested_date::date::timestamptz else null end
  ) returning id into new_project;

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

create or replace function public.release_project_for_client_review(target_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_row public.projects%rowtype;
  target_version uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into project_row from public.projects where id = target_project for update;
  if not found or not private.can_manage_workspace(project_row.workspace_id) then raise exception 'Project unavailable'; end if;
  if project_row.status <> 'internal_review' then raise exception 'Project is not in internal review'; end if;

  select id into target_version from public.video_versions
  where project_id = target_project and status in ('submitted', 'resubmitted')
  order by version_number desc limit 1 for update;
  if target_version is null then raise exception 'No submitted video version is ready'; end if;

  update public.video_versions set status = 'in_review' where id = target_version;
  update public.projects set status = 'client_review', updated_at = now() where id = target_project;
  insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
  values (project_row.workspace_id, target_project, (select auth.uid()), 'project.released_for_client_review', jsonb_build_object('version_id', target_version));
end
$$;
revoke all on function public.release_project_for_client_review(uuid) from public, anon;
grant execute on function public.release_project_for_client_review(uuid) to authenticated;

create or replace function private.audit_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
    values (new.workspace_id, new.id, (select auth.uid()), 'project.status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end
$$;
revoke all on function private.audit_project_status_change() from public, anon, authenticated;
drop trigger if exists audit_project_status_change on public.projects;
create trigger audit_project_status_change after update of status on public.projects
for each row execute function private.audit_project_status_change();

create or replace function private.audit_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
    values (new.workspace_id, new.project_id, (select auth.uid()), 'task.status_changed', jsonb_build_object('task_id', new.id, 'from', old.status, 'to', new.status));
  end if;
  return new;
end
$$;
revoke all on function private.audit_task_status_change() from public, anon, authenticated;
drop trigger if exists audit_task_status_change on public.tasks;
create trigger audit_task_status_change after update of status on public.tasks
for each row execute function private.audit_task_status_change();

create or replace function private.can_comment_project_version(target_project uuid, target_version uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    join public.video_versions as version on version.project_id = project.id
    where project.id = target_project and version.id = target_version
      and private.can_access_project(project.id)
      and (
        private.current_workspace_role(project.workspace_id) in ('super_admin', 'agency_manager', 'video_editor')
        or exists (
          select 1 from public.project_memberships as reviewer
          where reviewer.project_id = project.id and reviewer.user_id = (select auth.uid())
            and reviewer.role = 'external_reviewer' and reviewer.status = 'active'
            and version.status in ('submitted', 'in_review', 'changes_requested', 'resubmitted')
        )
        or exists (
          select 1 from public.clients as client
          where client.id = project.client_id and client.user_id = (select auth.uid())
            and version.status in ('submitted', 'in_review', 'changes_requested', 'resubmitted')
        )
      )
  )
$$;
revoke all on function private.can_comment_project_version(uuid, uuid) from public, anon;
grant execute on function private.can_comment_project_version(uuid, uuid) to authenticated;

create or replace function private.can_view_project_version(target_project uuid, target_version uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    join public.video_versions as version on version.project_id = project.id
    where project.id = target_project and version.id = target_version
      and private.can_access_project(project.id)
      and (
        private.current_workspace_role(project.workspace_id) in ('super_admin', 'agency_manager', 'video_editor')
        or version.status in ('submitted', 'in_review', 'changes_requested', 'resubmitted', 'approved')
      )
  )
$$;
revoke all on function private.can_view_project_version(uuid, uuid) from public, anon;
grant execute on function private.can_view_project_version(uuid, uuid) to authenticated;

drop policy if exists versions_read_project on public.video_versions;
create policy versions_read_project on public.video_versions for select to authenticated using (
  (select private.can_view_project_version(project_id, id))
);

drop policy if exists comments_read_project on public.review_comments;
create policy comments_read_project on public.review_comments for select to authenticated using (
  (select private.can_view_project_version(project_id, version_id))
);

drop policy if exists comments_insert_project on public.review_comments;
create policy comments_insert_project on public.review_comments for insert to authenticated with check (
  author_id = (select auth.uid())
  and (select private.can_comment_project_version(project_id, version_id))
);

update storage.buckets set allowed_mime_types = array[
  'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','image/jpeg','image/png','image/webp',
  'application/pdf','text/plain','application/zip','application/x-zip-compressed'
] where id = 'CREATIVEXSTUDIO';
