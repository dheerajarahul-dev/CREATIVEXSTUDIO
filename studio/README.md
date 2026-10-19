# Creative X Studio application

This directory contains the private Next.js workspace, Supabase migrations, Storage policies, and RLS tests. Follow the repository-level [`README.md`](../README.md) for local Supabase setup, first-administrator bootstrap, development commands, and production limitations.

Never commit `.env.local`. Keep `SUPABASE_SECRET_KEY` on the server only; browser code uses only the public Supabase URL and publishable key.
