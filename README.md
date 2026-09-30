# Preflux

A pre-push code security and risk analysis system. On every `git push` it checks:

- **exposed secrets** (regex + Shannon entropy, local), which always block the push
- **bug risk** of the change (XGBoost on Git history)
- **structural merge-conflict risk** (Tree-sitter ASTs)

The results are combined into one **Push Safety Score**, explained in plain English, and tracked on a team dashboard.

See [docs/architecture.md](docs/architecture.md) for the full design and build phases.

## Repo layout
| Path | What |
|---|---|
| `apps/web` | Next.js + Supabase dashboard |
| `packages/cli` | `preflux` CLI and git hook |
| `packages/shared` | shared TypeScript types |
| `services/ml` | FastAPI ML and explanation service |
| `supabase/migrations` | database schema |
| `docs` | architecture, features, scoring, API |

## Getting started
```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase values
npm run dev:web
```
