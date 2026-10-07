# Bug-risk features (spec v1)

Preflux predicts how likely each change is to introduce a bug. This is **just-in-time (JIT) defect prediction** (Kamei et al., 2013). The unit of prediction is one **(commit, file)** pair: a file that a commit changed and that still exists afterwards.

The machine-readable spec is [`packages/shared/src/ml/features.json`](../packages/shared/src/ml/features.json): the feature order, the bug-fix regex, the analysed file types and the caps. Both implementations read it:

| Where | Implementation | Used for |
|---|---|---|
| CLI, on every push | `packages/cli/src/features/extract.ts` | live prediction |
| Python, offline | `services/ml/training/features.py` | building the training set |

**Parity is enforced.** `fixtures/feature-repo.bundle` is a small Git history with fixed authors and dates. `fixtures/feature-repo.expected.json` holds the features the Python extractor computes for it. The vitest suite (`test/features.test.ts`) and the pytest suite (`tests/test_features.py`) both assert against that same file, so if the two implementations drift apart, a test fails.

## Features

"Prior" means non-merge commits that came before commit *c* in history.

| Feature | Meaning | Why it predicts bugs |
|---|---|---|
| `la` | lines added to the file by *c* | bigger changes have more room for mistakes |
| `ld` | lines deleted from the file by *c* | same |
| `nf` | number of analysed files *c* changed | wide changes are harder to reason about |
| `entropy` | how evenly *c*'s changed lines spread across its files: −Σ pᵢ log₂ pᵢ / log₂(nf), where pᵢ = (laᵢ + ldᵢ) / total. 0 if nf ≤ 1 | scattered changes are riskier than focused ones |
| `nuc` | prior commits that touched this file | frequently changed files are unstable |
| `ndev` | distinct author emails among those commits | many hands, less shared understanding |
| `age_days` | days since the file's previous change (0 if new) | recently churned code is riskier |
| `prior_fixes` | prior bug-fix commits that touched this file | bugs cluster in the same files |
| `exp` | prior commits by this author, in this repository | experienced developers introduce fewer bugs |
| `is_fix` | 1 if *c*'s subject matches the fix regex | fixes often introduce new bugs |
| `loc` | lines in the file after *c* | large files are harder to change safely |

## Exact rules (both implementations)

- **Analysed files:** `.js .jsx .ts .tsx .mjs .cjs .py`.
- **Deleted files** produce no row, but deletions still count as a "change" in that path's history.
- **Renames** are treated as delete(old path) + add(new path), as with `git --no-renames`. History is keyed by path, and renames aren't followed.
- **Commit subject** is `git log --format=%s`: the first paragraph of the message, with its lines joined by spaces.
- **Bug-fix regex** (case-insensitive): `\b(fix(e[sd]|ing)?|bug(s|fix)?|defect|hotfix|patch(ed)?|resolve[sd]?|regression|crash(es)?)\b`. "Fix crash" matches; "prefix" and "Debug" don't.
- **Authors** are compared by lower-cased email.
- **Times** use the author timestamp (`%at`).
- **Line count:** the number of `\n` characters, plus 1 if the file doesn't end with a newline.
- **Caps:** when mining, commits that change more than `maxFilesPerCommit` (50) analysed files are skipped as bulk/refactor noise, though they still update history. On a push, at most `maxRowsPerPush` (200) rows are scored; the most recent are kept.

## Privacy

The CLI computes these numbers **on the developer's machine**. `POST /predict` receives only the numbers and opaque row ids (`r0`, `r1`, …). File paths, code and commit messages never leave the machine. Results are mapped back to file names locally.

## Known approximation

When mining, the Python extractor walks history oldest-first and counts "prior" in traversal order. On a non-linear history (merged branches) it can count a few commits that aren't ancestors of *c*. The CLI uses the exact ancestors (`git log <c>^`). The two are identical on linear history, which the parity fixture covers. The difference on real repositories is small, and it only affects the training data.

## Labels: SZZ

Training labels come from the SZZ algorithm (Śliwerski, Zimmermann & Zeller, 2005):

1. Find bug-fix commits, using the same regex.
2. For each analysed file the fix modified, `git blame` the lines it changed or deleted.
3. The commits that last touched those lines are labelled **bug-inducing** for that file.

Changes from the last 180 days of each repository are dropped (right-censoring): they haven't had time to be fixed yet, so "no label" there means "unknown", not "clean".
