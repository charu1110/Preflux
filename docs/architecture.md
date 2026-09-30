# Preflux — Build Plan (Pre-Push Code Security & Risk Analysis System)

## Context
Major project (GNDEC B.Tech CSE, Charu / Bhumi / Aditi Kaushal). Synopsis: `C:\Users\Vikas Kumar\Downloads\preflux_synopsis.pdf`.
Preflux runs on `git push`, **before** code leaves the machine, and does three things:
1. **Secret detection**: regex plus Shannon entropy, fully local. A detected secret always blocks the push.
2. **Bug-risk prediction**: XGBoost trained on mined Git history, labelled with SZZ, using Kamei-style JIT features.
3. **Structural conflict detection**: Tree-sitter ASTs find logic-level conflicts that a text diff misses.

The results are combined into one **Push Safety Score**. An **LLM only explains** findings that are already computed. It never decides. Teams see the results in a web dashboard.

`D:\charu\Preflux` is empty, so this is a greenfield project.

**Decisions confirmed with the user (these change the synopsis):**
- **Stack:** Next.js + Supabase (Postgres, Auth, RLS) replaces MERN/MongoDB. Note this in the report: Supabase gives auth and row-level security, and Next.js route handlers take the place of Express.
- **LLM:** a pluggable provider interface. The default is a `mock` provider, and the real provider will be chosen later.
- **Languages for analysis (v1):** JavaScript/TypeScript and Python.

---

## 1. Architecture

```
 Developer machine                                         Cloud (free tiers)
 ─────────────────────────────────────────────            ───────────────────────────
 git push
   └─ .husky/pre-push ──► preflux scan --hook (Node/TS CLI)
        1. read pre-push stdin → commit range
        2. SECRET SCAN (local, no network)  ──► secret found ⇒ BLOCK (hard override)
        3. feature extraction (git log/diff)  ──► POST /predict ──► ML service (FastAPI, Python)
        4. CONFLICT SCAN: fetch remote, merge-base,           XGBoost model  (Render)
           Tree-sitter (WASM) symbol-level compare            /explain → LLM provider
        5. SCORE = weighted(bug, conflict) + overrides
        6. REDACT findings ──► POST /explain (optional)
        7. print terminal report, exit 0 / 1
        8. REDACTED report ──► POST /api/ingest ─────────────► Next.js dashboard (Vercel)
                                                                 │  route handlers
                                                                 ▼
                                                              Supabase Postgres + Auth + RLS
```
Rules:
- **Nothing leaves the machine before the secret scan and redaction have run.** Uploads carry only the rule id, file, line, a fingerprint hash and a masked snippet. They never carry the raw secret.
- **Fail-open for the ML and LLM parts:** if the service can't be reached, the CLI marks that part "skipped" and still enforces the secret block. **Fail-closed for secrets.**
- The CLI authenticates to ingest with a **per-project token**, which is stored hashed. The ingest route uses `SUPABASE_SERVICE_ROLE_KEY`, which stays server-only and is never `NEXT_PUBLIC_`.

## 2. Repository structure (npm workspaces monorepo)
```
Preflux/
├─ CLAUDE.md                  project rules for Claude (created now)
├─ README.md
├─ package.json               workspaces: apps/*, packages/*
├─ .gitignore  .env.example
├─ docs/
│  ├─ architecture.md         diagram above + data flow
│  ├─ features.md             EXACT ML feature definitions (single source of truth)
│  ├─ scoring.md              score formula, thresholds
│  └─ api.md                  /predict, /explain, /api/ingest contracts
├─ packages/
│  ├─ shared/                 TS types: Finding, ScanReport, Decision, ScoreConfig
│  └─ cli/                    `preflux` npm package (TypeScript)
│     └─ src/
│        ├─ index.ts          commander: init | scan | link | config
│        ├─ commands/         init.ts (installs husky + .husky/pre-push + .prefluxrc.json), scan.ts, link.ts
│        ├─ git/              prePushInput.ts (stdin parsing), diff.ts, log.ts, remote.ts
│        ├─ secrets/          patterns.ts (AWS, GitHub, Stripe, Google, JWT, private keys, DB URLs…),
│        │                    entropy.ts (Shannon, base64/hex thresholds), scanner.ts, allowlist.ts
│        ├─ features/         extract.ts (per-file JIT features per docs/features.md)
│        ├─ conflicts/        parser.ts (web-tree-sitter + JS/TS/Python grammars), symbols.ts,
│        │                    compare.ts (3-way symbol compare)
│        ├─ score/            pushSafetyScore.ts
│        ├─ redact/           redact.ts
│        ├─ api/              mlClient.ts, dashboardClient.ts
│        └─ report/           terminal.ts (chalk table + explanations)
├─ services/ml/               Python 3.10+ FastAPI
│  ├─ app/main.py             GET /health, POST /predict, POST /explain
│  ├─ app/model.py            loads models/bugrisk.json
│  ├─ app/llm/                base.py (Provider interface), mock.py, (real provider later)
│  ├─ training/               mine.py (PyDriller), szz.py, features.py, train.py, evaluate.py
│  ├─ models/                 bugrisk.json (committed) + metrics.json
│  ├─ tests/                  pytest
│  └─ requirements.txt
├─ apps/web/                  Next.js (App Router, TS, Tailwind)
│  ├─ lib/supabase.ts         ◄── requested helper (created now)
│  ├─ app/login, app/dashboard, app/projects/[id], app/pushes/[id], app/settings/tokens
│  └─ app/api/ingest/route.ts
├─ supabase/migrations/       0001_init.sql (schema + RLS)
└─ fixtures/                  sample repos with seeded secrets / conflicts for tests & evaluation
```
Key library choices: `commander`, `execa` (git), `web-tree-sitter` (WASM, so there are no native builds on Windows), `chalk`, `vitest`, `husky`. Python side: `fastapi`, `uvicorn`, `xgboost`, `pydriller`, `pandas`, `scikit-learn`, `pytest`.

## 3. Data model (Supabase / Postgres)
| table | key columns |
|---|---|
| `profiles` | id (= auth.users.id), name |
| `teams`, `team_members` | team_id, user_id, role |
| `projects` | id, team_id, name, repo_url, score_config jsonb |
| `project_tokens` | project_id, token_hash, last_used_at |
| `push_events` | id, project_id, branch, from_sha, to_sha, author, score, decision (allow/warn/block), timings, created_at |
| `findings` | push_id, kind (secret/bug_risk/conflict), severity, file, line, rule, masked_snippet, fingerprint, explanation |
| `file_risks` | push_id, file, probability, features jsonb |

RLS: a user can read rows only where they are a member of the project's team. The ingest route writes with the service role after validating the project token.

## 4. Push Safety Score (docs/scoring.md)
- `bugRisk` is the maximum file probability, weighted by lines changed (0 to 1). `conflictRisk` is 0 to 1, based on the count and severity of symbol conflicts.
- `score = round(100 × (1 − (0.6·bugRisk + 0.4·conflictRisk)))`. The weights can be set in `.prefluxrc.json`.
- Decision: **any secret → BLOCK (score forced to 0)**; score ≥ 70 → ALLOW; 40 to 69 → WARN (the push is allowed and the warning is printed); below 40 → BLOCK. `--force` bypasses a non-secret block, and the dashboard records that it was used.
- Weights and thresholds get tuned in Phase 6 against the fixture repos.

## 5. Build phases, objective by objective
Each phase ends with a working, demo-able deliverable plus tests.

**Phase 0: Foundation (implemented right after approval)**
- `git init` in `D:\charu\Preflux`. Create the root `package.json` (workspaces), `.gitignore`, `.env.example` and `README.md`.
- Create `CLAUDE.md`: the project summary, the architecture rules above (the secrets-first rule, the redaction rule, "the LLM only explains", fail-open/fail-closed), the directory map, stack conventions (TS strict, Python typed, vitest/pytest), commands, env vars, and the phase checklist.
- Scaffold `apps/web` with `create-next-app` (TS, Tailwind, App Router, ESLint), then `npm i @supabase/supabase-js` in `apps/web`.
- Create `apps/web/lib/supabase.ts`:
  ```ts
  import { createClient } from "@supabase/supabase-js";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (see apps/web/.env.example)");
  }
  export const supabase = createClient(supabaseUrl, supabaseAnonKey);
  ```
- Create `apps/web/.env.example` with the two public vars and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- Create empty workspace folders `packages/cli`, `packages/shared`, `services/ml`, `supabase/migrations`, `docs`, each with a minimal README.

**Phase 1: Objective 1, Secret detection + CLI + hook**
- CLI skeleton; `preflux init` (installs husky and writes the hook and config); `preflux scan` (both `--hook` mode and a manual range mode).
- Pre-push stdin parsing: `<local ref> <local sha> <remote ref> <remote sha>`. A new branch is diffed against the merge-base with the default branch. A deletion push is skipped.
- Scan only the **added lines** of the pushed diff. Patterns plus entropy (base64 > 4.5, hex > 3.0, minimum length 20). Allowlist via `.prefluxignore` and inline `preflux:allow`.
- Tests: fixtures with seeded secrets, measuring precision and recall of the patterns. Deliverable: pushing an AWS key is blocked.

**Phase 2: Objective 2a, Bug-risk ML**
- Write `docs/features.md`: la, ld, nf, entropy, ndev, nuc, age, prior_fixes, complexity.
- `training/`: mine 5 to 10 public JS/Python repos with PyDriller, label them with SZZ, then run `train.py` with a time-ordered split, `scale_pos_weight` for class imbalance, and evaluation by precision, recall and F1. Save `models/bugrisk.json` and `metrics.json`.
- FastAPI `/predict` takes a feature matrix and returns per-file probabilities.
- CLI `features/extract.ts` implements the same definitions. A **parity test** runs the Python and TS extractors on the same fixture repo and checks they produce identical values.

**Phase 3: Objective 2b, Structural conflict detection**
- `git fetch` the target branch, then compute the merge-base.
- For each file changed on **both** sides, parse the base, local and remote versions with Tree-sitter and extract functions, classes and methods with their ranges.
- Flag these cases:
  - the same symbol is edited on both sides, even when the lines don't overlap
  - a signature changes on one side while the other side adds or changes calls to that symbol
  - a symbol is deleted or renamed on one side while the other side still references it
- Tests: fixture branch pairs that Git merges cleanly but that are logically in conflict.

**Phase 4: Objective 3a, Scoring, redaction, explanations**
- Build `pushSafetyScore.ts` and `redact.ts`, which masks secrets, strips absolute paths and limits snippets to ±2 lines.
- `/explain`: redacted findings go in, and plain-English text plus remediation steps come out. It uses the provider interface with `mock` as the default, and the real LLM plugs in later.
- Build the terminal report UI.

**Phase 5: Objective 3b, Dashboard (Next.js + Supabase)**
- `0001_init.sql` schema plus RLS. Supabase Auth login (add `@supabase/ssr` here for cookie sessions).
- Pages: team overview (repo health), a project page (score trend, bug-risk trend, blocked vs allowed pushes), push detail (findings and explanations), and token management.
- `/api/ingest`: validates the token, then inserts the push, its findings and its file risks. `preflux link <token>` stores the token in the user's config, outside the repo.

**Phase 6: Integration, evaluation, deployment**
- End-to-end runs on the fixture repos. Tune thresholds and weights.
- Comparative evaluation: run Gitleaks and TruffleHog on the same seeded fixtures and put a detection table in the report. Compare SonarQube, GitGuardian and Copilot qualitatively.
- Deploy: web to Vercel, ML to Render, database on Supabase, and publish the CLI to npm so `npx preflux init` works. Finish the docs.

## 6. Verification
- **Phase 0 (now):** `npm run build` in `apps/web` with a dummy `.env.local` succeeds. Deleting the env vars gives the clear "Missing NEXT_PUBLIC_SUPABASE_URL…" error. `npm ls @supabase/supabase-js` shows the package installed. `CLAUDE.md` exists at the repo root.
- **Later phases:** `npm test` (vitest) for the CLI, `pytest` for the ML service, fixture-based end-to-end runs (`git push` to a local bare remote with the hook installed), and a browser check of dashboard pages through the preview tools.
