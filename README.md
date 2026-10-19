# Creative X Studio

A separate, role-scoped production workspace for video agencies, built with Next.js 16 and Supabase. The root route redirects to the private Studio; this checkout does not contain the original public Creative X portfolio.

## Local development

Install Node.js 20.9 or newer, Docker Desktop, and the Supabase CLI for the local backend.

```powershell
npm run install:studio
npx supabase start --workdir studio
npx supabase status --workdir studio
```

Copy `studio/.env.example` to `studio/.env.local`. The Supabase URL and `CREATIVEXSTUDIO` bucket are prefilled from your project link; add the project's publishable key and server-only secret key from Supabase Settings → API Keys. Never expose or commit the secret key. No `.env.local` is committed or included in this repository.

Apply migrations and start the web app:

```powershell
npx supabase db reset --workdir studio
npm run dev
```

Open `http://localhost:3000`. With no Supabase values configured, `/studio` displays setup guidance and does not seed fake users, projects, or passwords.

## First administrator

Signup is disabled and the Studio is invitation-only. Create `dheeraj@gmail.com` in the Supabase Auth dashboard and set its password there. Then run this once in the Supabase SQL editor, replacing the email with the account you created:

```sql
with first_admin as (
  select id from auth.users where email = lower('dheeraj@gmail.com')
), workspace as (
  insert into public.workspaces (name, slug, created_by)
  select 'Creative X Creations', 'creative-x-creations', id from first_admin
  on conflict (slug) do update set name = excluded.name
  returning id
)
insert into public.workspace_memberships (workspace_id, user_id, role, status)
select workspace.id, first_admin.id, 'super_admin', 'active'
from workspace cross join first_admin
on conflict (workspace_id, user_id) do update set role = 'super_admin', status = 'active';
```

The Auth user trigger creates the matching profile. The Studio login pre-fills `dheeraj@gmail.com`; the password is intentionally not stored in source. Add the workspace membership using the SQL bootstrap above before signing in, then invite editors and clients. Configure the Auth site URL and email provider before relying on invitation delivery. I could not create the user because the linked dashboard requires your authenticated session.

## Implemented production workflow

- Supabase cookie sessions, invite-only access, password reset, and role-aware server workspace resolution
- Postgres schema and RLS for profiles, workspaces, invitations, project intake, projects, memberships, tasks, media, video versions, comments, approvals, events, and notifications
- Client project request submission and transactional manager acceptance/assignment
- Project detail with RLS-scoped tasks, version history, reviewer comments, version-specific approval, and audit activity
- Private Storage bucket policies, resumable TUS uploads directly from browser to Storage, server-verified asset registration, and five-minute signed downloads
- Server-authorized project search/status filters and role-adaptive workspace navigation
- Operational responsive interface with accessible loading, empty, error, and success states

## Verification

```powershell
npm run typecheck
npm --prefix studio run lint
npm run build
```

The project-access SQL test is in `studio/supabase/tests/project_access.test.sql`; run it against local Supabase after `supabase start` with the local test tooling configured.

## Not yet production-complete

Supabase keys, email provider, deployed host, and source logo/reference screenshot were not available in the workspace. The database-backed workflows compile but have not been exercised against your Supabase instance. The bucket migration makes `CREATIVEXSTUDIO` private; confirm that is appropriate for everything already in that bucket before applying it. Messaging, calendar, workflow automation, reports, AI services, two-factor authentication, client intake file attachments, notifications/email, editor workload views, media transcoding/thumbnails, and signed-link audit/retention policies remain to be implemented. Do not publish for client use until migrations and RLS tests pass, the first administrator is bootstrapped, Auth/email settings are configured, and role-isolation tests pass.
