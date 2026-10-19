begin;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'studio-admin@example.test', '', now(), '{}'::jsonb, '{"display_name":"Studio Admin"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-one@example.test', '', now(), '{}'::jsonb, '{"display_name":"Client One"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-two@example.test', '', now(), '{}'::jsonb, '{"display_name":"Client Two"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assigned-editor@example.test', '', now(), '{}'::jsonb, '{"display_name":"Assigned Editor"}'::jsonb, now(), now());

insert into public.workspaces (id, name, slug, created_by)
values ('10000000-0000-4000-8000-000000000001', 'Test Studio', 'test-studio', '00000000-0000-4000-8000-000000000001');
insert into public.workspace_memberships (workspace_id, user_id, role)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'super_admin'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'client'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'client'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'video_editor');
insert into public.clients (id, workspace_id, user_id, company_name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Client One Company'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Client Two Company');
insert into public.projects (id, workspace_id, client_id, title, created_by)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Client One Project', '00000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Client Two Project', '00000000-0000-4000-8000-000000000001');
insert into public.project_memberships (project_id, user_id, role, assigned_by)
values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'video_editor', '00000000-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.projects), 1, 'client sees only their project');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select is((select count(*)::integer from public.projects), 1, 'editor sees only assigned projects');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.projects), 2, 'super admin sees workspace projects');

select * from finish();
rollback;
