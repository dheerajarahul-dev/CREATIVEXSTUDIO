create table if not exists private.invite_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
revoke all on private.invite_rate_limits from public, anon, authenticated;

create or replace function private.can_edit_project_version(target_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    where project.id = target_project
      and (
        private.current_workspace_role(project.workspace_id) in ('super_admin', 'agency_manager')
        or exists (
          select 1 from public.project_memberships as member
          where member.project_id = project.id and member.user_id = (select auth.uid())
            and member.role = 'video_editor' and member.status = 'active'
        )
      )
  )
$$;

create or replace function private.can_approve_project(target_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects as project
    where project.id = target_project
      and (
        exists (select 1 from public.clients as client where client.id = project.client_id and client.user_id = (select auth.uid()))
        or exists (
          select 1 from public.project_memberships as member
          where member.project_id = project.id and member.user_id = (select auth.uid())
            and member.role = 'external_reviewer' and member.status = 'active'
        )
      )
  )
$$;

revoke all on function private.can_edit_project_version(uuid) from public, anon;
revoke all on function private.can_approve_project(uuid) from public, anon;
grant execute on function private.can_edit_project_version(uuid) to authenticated;
grant execute on function private.can_approve_project(uuid) to authenticated;

drop policy if exists versions_insert_assigned_editor on public.video_versions;
create policy versions_insert_assigned_editor on public.video_versions for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.can_edit_project_version(project_id))
  and exists (select 1 from public.projects where id = project_id and workspace_id = video_versions.workspace_id)
  and exists (select 1 from public.media_assets where id = asset_id and project_id = video_versions.project_id and workspace_id = video_versions.workspace_id)
);
drop policy if exists versions_update_assigned_editor on public.video_versions;
create policy versions_update_assigned_editor on public.video_versions for update to authenticated
using ((select private.can_edit_project_version(project_id)) and status in ('draft', 'changes_requested'))
with check ((select private.can_edit_project_version(project_id)) and status in ('draft', 'submitted', 'changes_requested', 'resubmitted'));
revoke insert, update on public.video_versions from authenticated;
grant insert (workspace_id, project_id, asset_id, version_number, label, notes, status, submitted_by, submitted_at) on public.video_versions to authenticated;
grant update (label, notes, status, submitted_at) on public.video_versions to authenticated;

revoke insert, update, delete on public.approvals from authenticated;

create or replace function public.approve_video_version(target_version uuid, decision text, decision_note text default '')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  version_row public.video_versions%rowtype;
  next_project_status public.project_status;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if decision not in ('approved', 'changes_requested') then raise exception 'Invalid decision'; end if;

  select * into version_row from public.video_versions where id = target_version for update;
  if not found or not private.can_approve_project(version_row.project_id) then raise exception 'Version unavailable'; end if;
  if version_row.status not in ('submitted', 'in_review', 'resubmitted') then raise exception 'Version is not awaiting review'; end if;

  next_project_status := case
    when decision = 'approved' then 'final_approval'::public.project_status
    else 'revisions_requested'::public.project_status
  end;
  insert into public.approvals (project_id, version_id, decision, note, decided_by)
  values (version_row.project_id, version_row.id, decision, left(decision_note, 5000), (select auth.uid()));
  update public.video_versions set status = decision where id = version_row.id;
  update public.projects set status = next_project_status, updated_at = now() where id = version_row.project_id;
  insert into public.project_events (workspace_id, project_id, actor_id, event_type, details)
  values (version_row.workspace_id, version_row.project_id, (select auth.uid()), 'video.approval_decided', jsonb_build_object('version_id', version_row.id, 'decision', decision));
end
$$;
revoke all on function public.approve_video_version(uuid, text, text) from public, anon;
grant execute on function public.approve_video_version(uuid, text, text) to authenticated;

create or replace function public.consume_workspace_invite_rate_limit(target_user uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  count_in_window integer;
begin
  insert into private.invite_rate_limits (user_id, window_started_at, request_count)
  values (target_user, clock_timestamp(), 1)
  on conflict (user_id) do update set
    window_started_at = case
      when clock_timestamp() - private.invite_rate_limits.window_started_at >= interval '15 minutes' then clock_timestamp()
      else private.invite_rate_limits.window_started_at
    end,
    request_count = case
      when clock_timestamp() - private.invite_rate_limits.window_started_at >= interval '15 minutes' then 1
      else private.invite_rate_limits.request_count + 1
    end
  returning request_count into count_in_window;
  return count_in_window <= 10;
end
$$;
revoke all on function public.consume_workspace_invite_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_workspace_invite_rate_limit(uuid) to service_role;
