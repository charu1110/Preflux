# Structural conflict detection

Git merges **lines of text**. If you and a teammate edit *different lines of the same function*, Git merges both edits without complaint, even when together they break the function. Git also doesn't notice when one person changes a function's parameters while another adds new calls using the old ones.

Preflux catches these **logic-level conflicts** at `git push`, before the pull request. It does this by comparing the *structure* of the code (functions, methods, classes) rather than its lines.

## How it works

On every push (and on `preflux scan`):

1. **Find their side.** Preflux fetches the team's base branch, `<remote>/<default branch>` (for example `origin/main`), so it sees teammates' latest work. If the fetch fails or times out (15 s), it uses the last known state and says so.
2. **Find the common ancestor.** `git merge-base <your commit> origin/main` is the version both sides started from.
3. **Text conflicts.** `git merge-tree --write-tree` asks Git which files would produce an ordinary merge conflict, without touching your working tree.
4. **Structure.** Every JS/TS/Python file changed on either side is parsed with **Tree-sitter** in three versions: base, yours and theirs. Each version becomes a list of symbols:
   - functions, methods (`Class.method`), classes
   - CommonJS functions (`app.handle = function …`) and classes defined as expressions (`module.exports = class App …`)
   - the call sites in the file

   Each symbol records its parameters and its body.
5. **Changes per side.** For each symbol, base vs. side gives one of: *modified* (body), *signature* (parameters), *deleted*, *renamed* (same body under a new name) or *added*. New call sites are found by comparing call text, not line numbers.
6. **Rules.**

| Rule | Severity | Example |
|---|---|---|
| `conflict-same-function` | **high** if Git merges cleanly, medium if Git also reports a text conflict | You edit the top of `total()`, a teammate edits the bottom. Git merges silently. |
| `conflict-changed-api` | high | `origin/main` changed the parameters of `total()`, and your branch adds new calls to it (or the other way round) |
| `conflict-removed-vs-edited` | high | One side deleted or renamed `average()`, the other side edited it |
| `conflict-duplicate-definition` | medium | Both sides added a *different* `median()` |
| `conflict-text` | medium | Git will report an ordinary merge conflict in a file with no structural finding |

Messages name the teammate's commit, for example *"(51eb2c9 by Teammate)"*, so you know whom to talk to.

## Design choices

- **Informational, fail-open.** Conflicts never block a push; a feature branch is *expected* to diverge from main. Errors, a missing remote or a failed fetch all mean "skipped" or "last known state", never a blocked push. In Phase 4, conflicts feed the Push Safety Score with weight 0.4.
- **Local.** Code is parsed on the developer's machine; nothing is uploaded.
- **Fewer false alarms.** Calls are matched by name, since types can't be known without running the code. To keep that precise:
  - methods only count as called from the same file (usually via `this`/`self`)
  - very generic names (`get`, `map`, `push`, `render`, …) and names shorter than 3 characters are ignored
  - identical edits on both sides aren't reported
- **Fast.** The Tree-sitter WebAssembly runtime starts in about 30 ms. A fixed number of Git processes is used per push (`merge-base`, two `diff`s, `merge-tree`, one `log`, one `cat-file --batch`). On a copy of koa, the full scan including the fetch took about 3 s.
- **No native build.** Microsoft's prebuilt `@vscode/tree-sitter-wasm` grammars (JavaScript, TypeScript, TSX, Python) install on Windows, macOS and Linux without C++ build tools.

## Configuration (`.prefluxrc.json`)

```json
"conflicts": { "enabled": true, "baseBranch": "auto", "fetch": true, "fetchTimeoutMs": 15000 }
```

`baseBranch: "auto"` uses the remote's default branch (`origin/HEAD`, else `main`, else `master`). Set it to `"develop"` (for example) to compare against another integration branch.

## Code

| File | Role |
|---|---|
| `packages/cli/src/conflicts/parser.ts` | Loads Tree-sitter and the grammars once; parses and frees syntax trees |
| `packages/cli/src/conflicts/symbols.ts` | Source → symbols + call sites |
| `packages/cli/src/conflicts/compare.ts` | The rules (pure, unit-tested) |
| `packages/cli/src/conflicts/analyze.ts` | Git orchestration: fetch, merge-base, merge-tree, blobs |
| `packages/cli/test/conflicts.test.ts` | Rule tests on JS/TS/Python snippets |
| `packages/cli/test/e2e.test.ts` | Two developers, a real remote, a real `git push` |

## Known limits

- Name-based call matching can still miss calls (dynamic dispatch, aliases) or, rarely, match an unrelated function with the same name.
- Renames are detected only when the body is unchanged. A rename that also changes the body appears as a deletion plus an addition.
- Only JavaScript, TypeScript and Python are parsed structurally. Other files get text-conflict detection only.
