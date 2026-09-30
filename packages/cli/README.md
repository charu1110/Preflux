# preflux (CLI)

Scans the commits you are about to push and **blocks the push if they contain a secret**: API keys, tokens, private keys, passwords, database URLs.
Everything runs locally; nothing is sent anywhere.

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

Exit codes: `0` allowed, `1` blocked, `2` internal error. In hook mode an internal error also **blocks** the push (fail closed).

## How detection works
1. **Known formats** (`src/secrets/patterns.ts`): AWS, GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, SendGrid, npm, private keys, JWTs, and DB connection strings with passwords.
2. **Keyword + entropy**: a literal assigned to `password`, `apiKey`, `secret`, … whose Shannon entropy is ≥ 3.0 bits/char.
3. **Pure entropy**: unexplained tokens of 20+ characters with entropy ≥ 4.5 (base64) that mix upper case, lower case and digits. Hex strings (≥ 3.0) are flagged only next to a secret-like name, because commit SHAs are hex.

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
