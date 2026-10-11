import { execFileSync, spawnSync } from "node:child_process";

export class GitError extends Error {}

export interface GitOptions {
  /** Kill git after this long (e.g. a network fetch inside the pre-push hook). */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Run a git command and return stdout. Throws GitError with git's stderr on failure. */
export function git(args: string[], cwd: string, opts: GitOptions = {}): string {
  try {
    return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs,
      env: opts.env ?? process.env,
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new GitError(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

/** Run git with stdin input and return raw stdout bytes (for `cat-file --batch`). */
export function gitBuffer(args: string[], cwd: string, input: string): Buffer {
  try {
    return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      input,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new GitError(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

/** Run git and return exit status + stdout without throwing (for commands whose exit code carries meaning). */
export function gitStatus(args: string[], cwd: string): { status: number | null; stdout: string } {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "" };
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
