# preflux (CLI)

Checks the commits you're about to push:
- **Secrets** (API keys, tokens, private keys, passwords, database URLs): **block the push**. Fully local.
- **Bug risk:** an ML estimate per changed file, with the reasons ("riskier than 89% of past changes, because 61 people edited this file"). Only numeric features go to the Preflux ML service. See `docs/features.md`.
- **Structural conflicts** with your team's base branch (`origin/main`): the same function edited on both sides, changed parameters vs. new callers, deleted vs. edited functions. Parsed locally with Tree-sitter. See `docs/conflicts.md`.
- **Collision Radar:** a heads-up when a teammate's unmerged branch is changing the same function as you.

Bug risk and conflicts combine into a **Push Safety Score** (0–100): ≥ 70 allows, 40–69 allows with warnings, < 40 blocks (override once with `PREFLUX_FORCE=1`). Secrets always block. See `docs/scoring.md`.

## Install into a repository
```bash
npm install -g preflux        # once published; for development see below
cd your-repo
preflux init                  # installs the pre-push hook + .prefluxrc.json + .prefluxignore
```
- **Node project** (`package.json` present): uses **husky** and writes `.husky/pre-push`. The hook is committed, so the whole team gets it.
- **Any other repo**, or with `--skip-install`: writes `.git/hooks/pre-push`.

## Commands
| Command | What it scans |
|---|---|
| `preflux scan` | commits not yet pushed to the upstream (or to any remote) |
| `preflux scan --staged` | staged changes, before you commit |
| `preflux scan --range main..feature` | any revision range |
| `preflux scan --hook` | used by the git hook (reads the pushed refs from stdin) |
| `--json` | machine-readable report on stdout |
| `preflux link <token> --url <dashboard>` | connect this repo to a dashboard project; every push is then recorded (`docs/dashboard.md`) |
| `preflux ci --base main` | the pull-request check used by the GitHub Action (`docs/github-action.md`) |

Exit codes: `0` allowed, `1` blocked, `2` internal error. In hook mode an internal error also **blocks** the push (fail closed).

## How detection works
1. **Known formats** (`src/secrets/patterns.ts`): AWS, GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, SendGrid, npm, private keys, JWTs, and DB connection strings with passwords.
2. **Keyword + entropy**: a literal assigned to `password`, `apiKey`, `secret`, … whose Shannon entropy is ≥ 3.0 bits/char.
3. **Pure entropy**: unexplained tokens of 20+ characters with entropy ≥ 4.5 (base64) that mix upper case, lower case and digits. Hex strings (≥ 3.0) are flagged only next to a secret-like name, because commit SHAs are hex. The host and path of web links are skipped (real changelogs link to GitHub advisories like `…/security/advisories/GHSA-…`), but a link's query string is still checked.

Every commit in the push is scanned, not just the final diff. A secret that was added and then deleted is still in history, and it still blocks the push.

Placeholders (`your-key`, `${VAR}`, `<password>`, `EXAMPLE`, …), lockfiles, minified files and data URIs are skipped.

## Handling false positives
- Put `preflux:allow` in a comment on that line.
- Add `fingerprint:<id>` (shown in the report) to `.prefluxignore`.
- Add a path glob to `.prefluxignore`, e.g. `docs/examples/**`.
- Tune thresholds in `.prefluxrc.json` → `secrets.entropy`.

## Development
```bash
npm run build:cli             # from repo root → packages/cli/dist
npm run test:cli              # unit tests + end-to-end pushes against a temporary bare remote
cd packages/cli && npm link   # puts `preflux` on your PATH so hooks can find it
```
