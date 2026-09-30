import { git } from "./exec.js";

/** One line added by a commit (or by the staging area). */
export interface AddedLine {
  commit: string;
  file: string;
  line: number;
  text: string;
}

const COMMIT_MARKER = "\u0001PREFLUX_COMMIT ";

/**
 * Parse `git log -p -U0` / `git diff -U0` output into added lines.
 * Only "+" lines matter for secret detection: removed lines are already on the remote.
 */
export function parseUnifiedDiff(output: string, defaultCommit = "STAGED"): AddedLine[] {
  const added: AddedLine[] = [];
  let commit = defaultCommit;
  let file: string | null = null;
  let nextLine = 0;

  for (const raw of output.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith(COMMIT_MARKER)) {
      commit = line.slice(COMMIT_MARKER.length).trim();
      file = null;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      file = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      file = target === "/dev/null" ? null : stripPrefix(target);
      continue;
    }
    if (line.startsWith("@@")) {
      // @@ -a[,b] +c[,d] @@
      const m = /\+(\d+)(?:,\d+)?/.exec(line);
      nextLine = m ? Number.parseInt(m[1]!, 10) : 0;
      continue;
    }
    if (file === null) continue;
    if (line.startsWith("+")) {
      added.push({ commit, file, line: nextLine, text: line.slice(1) });
      nextLine++;
    } else if (line.startsWith(" ")) {
      nextLine++; // context line (only present if -U > 0)
    }
    // "-" lines and "\ No newline at end of file" don't advance the new-file counter.
  }
  return added;
}

function stripPrefix(path: string): string {
  // Paths look like b/src/app.ts. Git quotes paths with unusual characters.
  let p = path;
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.startsWith("b/") ? p.slice(2) : p;
}

const DIFF_FLAGS = ["-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"];

/** Added lines for every non-merge commit in the revision set, so secrets added then deleted are still caught. */
export function addedLinesForRevisions(revArgs: string[], cwd: string): AddedLine[] {
  const out = git(["log", "-p", ...DIFF_FLAGS, "--no-merges", "--format=%x01PREFLUX_COMMIT %H", ...revArgs], cwd);
  return parseUnifiedDiff(out);
}

export function addedLinesStaged(cwd: string): AddedLine[] {
  return parseUnifiedDiff(git(["diff", "--cached", ...DIFF_FLAGS], cwd), "STAGED");
}
