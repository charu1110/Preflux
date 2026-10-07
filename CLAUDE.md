# Preflux — Pre-Push Code Security & Risk Analysis System

B.Tech CSE major project (GNDEC Ludhiana) by Charu, Bhumi and Aditi Kaushal.
Full build plan: `docs/architecture.md`.

## What Preflux does
Preflux runs as a Git **pre-push hook**, before code leaves the developer's machine:
1. **Secret detection**: regex patterns plus Shannon entropy, 100% local.
2. **Bug-risk prediction**: an XGBoost model trained on mined Git history (PyDriller + SZZ labels, Kamei JIT features).
3. **Structural conflict detection**: Tree-sitter ASTs (JS/TS + Python) find logic-level conflicts against the remote branch.

The results are combined into a **Push Safety Score** (allow / warn / block). An LLM only *explains* findings. A Next.js + Supabase dashboard gives teams push history and repo health.

## Non-negotiable rules
- **Secrets first, fail closed.** The secret scan runs before any network call. Any detected secret → BLOCK, whatever the score.
- **Redact before anything leaves the machine.** Uploads and LLM prompts may contain only the rule id, file, line, fingerprint hash and masked snippet. They must never contain a raw secret value or an absolute path.
- **The LLM never decides.** It turns already-computed findings into plain English. Scores and decisions are deterministic code.
- **Fail open for ML and LLM.** If the ML service or LLM can't be reached, mark that part "skipped" and continue. Don't block on outages.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (used by `apps/web/app/api/ingest`). Never prefix it with `NEXT_PUBLIC_`, and never import it into client components.
- Never commit real keys. `.env*` is gitignored, except `.env.example`. Test fixtures use obviously fake keys (e.g. AWS's documented `AKIAIOSFODNN7EXAMPLE`).
- ML features are defined once in `docs/features.md`. The TS extractor (CLI) and the Python extractor (training) must both match it, and a parity test enforces this.

## Stack (decided; differs from the synopsis, which said MERN)
| Part | Tech |
|---|---|
| CLI (`packages/cli`) | Node 20+, TypeScript (strict), commander, execa, chalk, husky, web-tree-sitter (WASM), vitest |
| Shared types (`packages/shared`) | TypeScript: `Finding`, `ScanReport`, `Decision`, `ScoreConfig` |
| ML/AI service (`services/ml`) | Python 3.10+, FastAPI, XGBoost, PyDriller, pandas, scikit-learn, pytest |
| Dashboard (`apps/web`) | Next.js (App Router) + Tailwind, `@supabase/supabase-js` (+ `@supabase/ssr` for auth later) |
| Database/Auth | Supabase Postgres with RLS (migrations in `supabase/migrations`) |
| LLM | Pluggable provider interface (`services/ml/app/llm`); the default is `mock`, and the real provider is still TBD |
| Deploy | Vercel (web), Render (ML), Supabase (DB), npm (CLI) |

`apps/web` uses a new Next.js major version. Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before writing Next.js code.

## Layout
```
apps/web/            Next.js dashboard; lib/supabase.ts = Supabase client helper
packages/cli/        `preflux` CLI: commands/, git/, secrets/, features/, conflicts/, score/, redact/, api/, report/
packages/shared/     shared TS types
services/ml/         FastAPI: /health, /predict, /explain; training/ (mine, szz, features, train, evaluate)
supabase/migrations/ SQL schema + RLS
docs/                architecture.md, features.md, scoring.md, api.md
fixtures/            sample repos with seeded (fake) secrets and conflicts
```

## Push Safety Score
`score = round(100 × (1 − (0.6·bugRisk + 0.4·conflictRisk)))`. Any secret sets the score to 0 → BLOCK. A score ≥ 70 → ALLOW, 40–69 → WARN, < 40 → BLOCK. `--force` bypasses non-secret blocks only, and each bypass is recorded. The weights and thresholds live in `.prefluxrc.json`. See `docs/scoring.md`.

## Commands
```bash
npm install                 # from repo root (npm workspaces)
npm run dev:web             # dashboard at http://localhost:3000
npm run build:web
npm run lint:web
npm run build:cli           # packages/cli/dist/index.js
npm run test:cli            # vitest: unit + e2e (real git pushes to a temp bare remote)
npm run typecheck:cli
```
ML service (run from `services/ml`, see `services/ml/README.md`):
```bash
.venv/Scripts/python -m pytest                              # feature parity, SZZ, training smoke, API
.venv/Scripts/python -m uvicorn app.main:app --port 8000    # CLI calls this (PREFLUX_ML_URL overrides)
.venv/Scripts/python training/mine.py | build_dataset.py | train.py | evaluate.py
```

## Bug-risk rules
- **Feature definitions live in `packages/shared/src/ml/features.json` + `docs/features.md`.** Any change must be made in *both* `packages/cli/src/features/extract.ts` and `services/ml/training/features.py`. Then regenerate `fixtures/feature-repo.expected.json` (see `services/ml/README.md`) and retrain.
- The CLI sends `/predict` only numbers and opaque ids (`r0`, `r1`…). Never send file paths, code or commit messages.
- Bug risk is informational until the Phase 4 score. It must never block a push, and any ML failure means "skipped".
- Keep CLI git calls constant per push (batched `git log` / `cat-file --batch`). Spawning git per file is far too slow on Windows.

## Windows TLS note
This machine intercepts HTTPS (antivirus/proxy root CA). Don't disable verification. Use the Windows certificate store instead:
- **pip:** install through the global pip 25+ with `pip --python <venv python>`
- **git clone:** `git -c http.sslBackend=schannel clone …`
- **Node:** v24+ with `--use-system-ca`

## Test rules
- **Never write a complete fake secret literal in source.** Generate secrets at runtime with `packages/cli/test/helpers/fake.ts` (a seeded PRNG plus split prefixes). Otherwise GitHub push protection, and Preflux itself, will flag this repo.
- A line that must contain a secret-like literal on purpose gets a `// preflux:allow <reason>` comment.
- Dogfood check: stage the repo into a temporary `GIT_INDEX_FILE`, then run `node packages/cli/dist/index.js scan --staged`. It should report 0 findings.

## Environment
- `apps/web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `services/ml`: `PREFLUX_MODEL_DIR` (default `models/`), `PREFLUX_FEATURE_SPEC`, `PREFLUX_LLM_PROVIDER` (Phase 4, default `mock`)
- CLI: `PREFLUX_ML_URL` (default `http://127.0.0.1:8000`)

## Conventions
- Windows dev machines, so keep scripts cross-platform (no bash-only npm scripts) and avoid native node-gyp modules. That is why the CLI uses web-tree-sitter.
- Small, focused modules. Every detector returns `Finding[]` in the shared shape.
- Tests live next to each phase: vitest for TS, pytest for Python. Fixtures go in `fixtures/`.
- Each phase ends with something that can be demoed.

## Phase checklist
- [x] Phase 0: monorepo, CLAUDE.md, Next.js scaffold, Supabase helper
- [x] Phase 1: Secret detection + CLI (`init`, `scan`) + husky pre-push hook. See `packages/cli/README.md`
- [x] Phase 2: Bug-risk ML (dataset mining, SZZ, XGBoost, FastAPI /predict, CLI feature extraction + parity test). Results: `docs/ml-evaluation.md`
- [ ] Phase 3: Tree-sitter structural conflict detection
- [ ] Phase 4: Scoring, redaction, LLM explanation layer (mock provider), terminal report
- [ ] Phase 5: Supabase schema + RLS, auth, dashboard pages, /api/ingest, `preflux link`
- [ ] Phase 6: E2E tests, tuning, comparison vs Gitleaks/TruffleHog, deployment, docs
