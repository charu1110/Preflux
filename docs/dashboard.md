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
2. **Database.** Open **SQL Editor → New query**, paste `supabase/migrations/0001_preflux.sql`, and click **Run**. Do the same, in order, for `0002_ai_explanations.sql` and `0003_fix_project_owner_read.sql`.
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

## AI explanations ("Explain with AI")

Each push page has an **Explain with AI** button. Claude writes a short, plain-English summary: *what happened, why it matters, what to do next*.

- **Setup (once):** run `supabase/migrations/0002_ai_explanations.sql` after `0001`, and put `ANTHROPIC_API_KEY=…` in `apps/web/.env.local` on the machine (or Vercel project) that runs the dashboard.
- **Who can use it:** every member of the project, through the dashboard. Only the server holds the key; teammates never need it.
- **What is sent to Claude:** the push's decision, score and branch, and each finding's rule, severity, file, line, message and reasons. Never code, secret values, snippets or fingerprints (the database doesn't have them).
- **Cost:** each push is explained at most once; the text is stored and reused. Model `claude-opus-5-5` at low effort, change it with `PREFLUX_AI_MODEL`.
- **The AI never decides.** Preflux's allow/warn/block is computed by code; the AI only explains it. Without a key, the page shows "not set up" and everything else works.

Code: `packages/shared/src/explain.ts` (what is sent, tested in `packages/cli/test/explain.test.ts`), `apps/web/lib/ai/explain.ts` (the Claude call), `apps/web/app/dashboard/actions.ts` (`explainPushAction`).

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
