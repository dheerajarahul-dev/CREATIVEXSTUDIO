insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'CREATIVEXSTUDIO',
  'CREATIVEXSTUDIO',
  false,
  5368709120,
  array['video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','image/jpeg','image/png','image/webp','application/pdf','text/plain','application/zip','application/x-zip-compressed']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists studio_private_read_project on storage.objects;
drop policy if exists studio_private_insert_project on storage.objects;
drop policy if exists studio_private_delete_manager on storage.objects;

create policy studio_private_read_project on storage.objects for select to authenticated using (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1]
      and private.can_access_project(project.id)
  )
);

create policy studio_private_insert_project on storage.objects for insert to authenticated with check (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1]
      and private.can_upload_project(project.id)
  )
);

create policy studio_private_delete_manager on storage.objects for delete to authenticated using (
  bucket_id = 'CREATIVEXSTUDIO' and exists (
    select 1 from public.projects as project
    where project.id::text = (storage.foldername(name))[1]
      and private.can_manage_workspace(project.workspace_id)
  )
);
