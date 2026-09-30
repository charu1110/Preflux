import { execFileSync } from "node:child_process";

export class GitError extends Error {}

/** Run a git command and return stdout. Throws GitError with git's stderr on failure. */
export function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new GitError(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

/** Like git(), but returns null instead of throwing. */
export function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

export function commitExists(sha: string, cwd: string): boolean {
  return tryGit(["cat-file", "-e", `${sha}^{commit}`], cwd) !== null;
}
