# Preflux on pull requests (GitHub Action)

Local hooks rely on every developer installing them, and `git push --no-verify` skips them. The **GitHub Action** runs Preflux on every pull request, for the whole team, with nothing to install on laptops.

On each PR it:
1. scans every commit in the PR against its base branch (secrets, bug risk, conflicts, Collision Radar)
2. posts **one comment** on the PR, and updates the same comment on every new push instead of adding new ones
3. writes the same report to the job summary
4. marks the check **red only when the Push Safety Score blocks** (or a secret is found)

## Add it to a repository

Create `.github/workflows/preflux.yml`:

```yaml
name: Preflux
on: pull_request

permissions:
  contents: read
  pull-requests: write # to post the comment

jobs:
  preflux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0                                    # full history: needed for conflicts and bug risk
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: charu1110/Preflux@main
        # with:
        #   ml-url: https://your-preflux-ml.onrender.com    # optional: enables bug-risk prediction
```

To make the check required, go to **Settings → Branches → Branch protection rule → Require status checks → `preflux`**.

## What the comment looks like

```
❌ Preflux: blocked — Push Safety Score 15/100

| Check       | Result                                          |
| 🔑 Secrets   | ✅ none found                                    |
| 🐞 Bug risk  | ⚠️ 1 of 3 files need attention                    |
| 🔀 Conflicts | ⚠️ 1 with the base branch, 👥 1 team heads-up      |

🐞 Riskiest files
- HIGH lib/app.js — riskier than 92% of past changes
  why: big change (+180 lines) · this file needed 7 bug fixes before

🔀 Conflicts
- HIGH calc.js:1 — total() was also edited on origin/main (51eb2c9 by Mate) …
- 👥 calc.js:7 — Priya is also changing average() on branch feature/coupons (not merged yet) …
```

Secrets are listed by rule and file only, never with a snippet, because PR comments on public repositories are public.

## Notes
- **Bug risk** needs a reachable ML service (`ml-url`). Without one, that row says "skipped" and the score uses conflicts only.
- **Forks:** PRs from forks get a read-only token, so the comment may not post. The check result still counts.
- **Override:** add `force: ${{ vars.PREFLUX_FORCE == 'true' }}` under `with:`, then set the repository variable `PREFLUX_FORCE` to `true` and re-run the job to let one blocked PR through. Secrets can never be overridden.
- **Locally:** the same check runs with `preflux ci --base main`.

Code: `action.yml`, `packages/cli/src/commands/ci.ts`, `packages/cli/src/report/markdown.ts`. Tests: `packages/cli/test/ci.test.ts`.
