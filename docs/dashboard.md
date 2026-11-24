# Team dashboard

The dashboard (`apps/web`, Next.js + Supabase) shows every push Preflux checks, for the whole team:
- **Overview:** your projects, each with its last score and the number of blocked pushes
- **Project page:**
  - pushes, blocked, warned and average score (last 30 days)
  - the score of the last 30 pushes
  - **files that keep getting flagged** (with the model's reasons)
  - **conflicts & team heads-ups**
  - **secrets stopped before leaving a laptop**
  - recent pushes
  - tokens and team members
- **Push page:** every finding of one push, with its explanation

## Setup (once)

1. **Supabase project.** In the Supabase dashboard, create a project, or **restore** a paused one (free projects pause after inactivity).
2. **Database.** Open **SQL Editor → New query**, paste `supabase/migrations/0001_preflux.sql`, and click **Run**.
3. **Environment.** In `apps/web/.env.local`, and in Vercel → Settings → Environment Variables, set:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
   ```
   No service-role key is needed.
4. **Run it.** `npm run dev:web` locally, or push to deploy on Vercel. Open `/login`, create an account, then create a project.

## Connect a repository

1. On the project page, click **Create token**. It's shown **once**, together with the exact command.
2. In the repository (after `preflux init`):
   ```bash
   preflux link pfx_… --url https://your-dashboard.vercel.app
   ```
   The link is saved in `.git/preflux-link.json`. That file lives inside `.git`, so it can never be committed.
3. Every `git push` now uploads its result. Pull-request checks can upload too, by adding `dashboard-url` and `dashboard-token` (as a repository secret) to the GitHub Action.

Teammates sign up with their own email. The project owner adds them under **Team**.

## What is uploaded, and what isn't

Uploaded: branch, short commit id, author name, score, decision, and per finding its kind, rule, severity, file, line, message and reasons.

**Never** uploaded: code, secret values, masked snippets, fingerprints or commit messages.

If the dashboard is down, the push still works, and the terminal says *"dashboard: not recorded"*.

## Security design

- **Row-level security on every table.** Users only see projects they're a member of.
- **Tokens are stored only as SHA-256 hashes**, and each one is tied to one project.
- **The CLI has no database access.** It calls `POST /api/ingest`, which validates the payload (`packages/shared/src/ingest.ts`) and calls the database function `ingest_push()`. That function checks the token and inserts the data with size limits.
- **Owners only:** creating and revoking tokens (`create_project_token`) and adding members (`add_project_member`) are database functions that check the caller owns the project.

Code: `supabase/migrations/0001_preflux.sql`, `apps/web/app/dashboard/`, `apps/web/app/api/ingest/route.ts`, `apps/web/proxy.ts`, `packages/cli/src/api/dashboardClient.ts`, `packages/cli/src/commands/link.ts`.
