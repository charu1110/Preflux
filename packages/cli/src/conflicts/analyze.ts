import type { Finding, ModuleResult } from "@preflux/shared";
import type { ConflictsConfig } from "../config.js";
import { readBlobs } from "../git/blobs.js";
import { git, gitStatus, tryGit } from "../git/exec.js";
import { findConflicts, type SideFile } from "./compare.js";
import { languageFor } from "./parser.js";
import { fileStructure } from "./symbols.js";

// Structural conflict detection against the team's integration branch (e.g. origin/main).
// Informational and fail-open: any problem means "skipped", never a blocked push.

const MAX_FILES_PER_SIDE = 300;

export interface ConflictResult {
  findings: Finding[];
  module: ModuleResult;
}

const lines = (out: string) => out.split("\n").map((l) => l.replace(/\r$/, "").trim()).filter(Boolean);

function refExists(ref: string, cwd: string): boolean {
  return tryGit(["rev-parse", "--verify", "-q", ref], cwd) !== null;
}

/** "main" from refs/remotes/origin/HEAD, else the first of main/master that exists. */
function resolveBaseBranch(remote: string, cfg: ConflictsConfig, cwd: string): string | null {
  if (cfg.baseBranch !== "auto") return cfg.baseBranch;
  const head = tryGit(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd)?.trim();
  if (head?.startsWith(`${remote}/`)) return head.slice(remote.length + 1);
  for (const candidate of ["main", "master"]) {
    if (refExists(`refs/remotes/${remote}/${candidate}`, cwd)) return candidate;
  }
  return null;
}

/** Bring <remote>/<branch> up to date. Returns a note when we have to fall back to the last known state. */
function fetchBase(remote: string, branch: string, cfg: ConflictsConfig, cwd: string): string | undefined {
  if (!cfg.fetch) return undefined;
  try {
    git(["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], cwd, {
      timeoutMs: cfg.fetchTimeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return undefined;
  } catch {
    return `could not fetch ${remote}/${branch}; used the last known state`;
  }
}

/** Files Git would report as text conflicts (git >= 2.38 `merge-tree --write-tree`). */
function textConflicts(ours: string, theirs: string, cwd: string): Set<string> {
  const r = gitStatus(["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], cwd);
  if (r.status !== 1) return new Set(); // 0 = clean; anything else = unsupported/error
  return new Set(lines(r.stdout).slice(1)); // first line is the resulting tree id
}

/** file -> "3f2a1c9 by Bob" for the latest commit touching it on their side. */
function theirsCommits(base: string, theirs: string, cwd: string): Map<string, string> {
  const out = git(["log", "--no-renames", "--name-only", "--format=%x1e%h%x1f%an", `${base}..${theirs}`], cwd);
  const latest = new Map<string, string>();
  for (const block of out.split("\u001e").slice(1)) {
    const [header, ...files] = lines(block);
    const [hash, author] = (header ?? "").split("\u001f");
    for (const f of files) if (!latest.has(f)) latest.set(f, `${hash} by ${author}`);
  }
  return latest;
}

async function sideFiles(paths: string[], base: string, tip: string, blobs: Map<string, string | null>): Promise<SideFile[]> {
  const out: SideFile[] = [];
  for (const path of paths) {
    out.push({
      path,
      base: await fileStructure(path, blobs.get(`${base}:${path}`) ?? null),
      side: await fileStructure(path, blobs.get(`${tip}:${path}`) ?? null),
    });
  }
  return out;
}

async function analyseTip(tip: string, theirsRef: string, label: string, cwd: string): Promise<Finding[]> {
  const theirs = git(["rev-parse", theirsRef], cwd).trim();
  const ours = git(["rev-parse", tip], cwd).trim();
  const base = tryGit(["merge-base", ours, theirs], cwd)?.trim();
  if (!base || base === theirs) return []; // unrelated histories, or nothing new on their side

  const changed = (to: string) =>
    lines(git(["diff", "--name-only", "--no-renames", base, to], cwd));
  const oursAll = changed(ours);
  const theirsAll = changed(theirs);
  if (oursAll.length === 0 || theirsAll.length === 0) return [];

  const oursCode = oursAll.filter((p) => languageFor(p)).slice(0, MAX_FILES_PER_SIDE);
  const theirsCode = theirsAll.filter((p) => languageFor(p)).slice(0, MAX_FILES_PER_SIDE);
  const specs = [...new Set([...oursCode.flatMap((p) => [`${base}:${p}`, `${ours}:${p}`]), ...theirsCode.flatMap((p) => [`${base}:${p}`, `${theirs}:${p}`])])];
  const contents = readBlobs(specs, cwd);
  const blobs = new Map(specs.map((s, i) => [s, contents[i] ?? null]));

  const commits = theirsCommits(base, theirs, cwd);
  return findConflicts(await sideFiles(oursCode, base, ours, blobs), await sideFiles(theirsCode, base, theirs, blobs), {
    theirsLabel: label,
    textConflicts: textConflicts(ours, theirs, cwd),
    theirsCommit: (file) => commits.get(file),
  });
}

/**
 * Compare each pushed tip with <remote>/<base branch>: what would merging it produce?
 * `tips` are commit-ishes (pushed local shas, or HEAD for a manual scan).
 */
export async function runConflicts(tips: string[], remote: string, cfg: ConflictsConfig, cwd: string): Promise<ConflictResult> {
  const started = performance.now();
  const done = (findings: Finding[], status: ModuleResult["status"], reason?: string): ConflictResult => ({
    findings,
    module: { status, reason, durationMs: Math.round(performance.now() - started) },
  });

  if (!cfg.enabled) return done([], "skipped", "disabled in .prefluxrc.json");
  if (tips.length === 0) return done([], "skipped", "nothing to compare");
  if (tryGit(["remote", "get-url", remote], cwd) === null) return done([], "skipped", `no remote named "${remote}"`);

  try {
    let branch = resolveBaseBranch(remote, cfg, cwd);
    let note: string | undefined;
    if (branch) {
      note = fetchBase(remote, branch, cfg, cwd);
    } else if (cfg.fetch) {
      // Fresh clone without remote-tracking refs yet: try the usual names.
      for (const candidate of ["main", "master"]) {
        if (!fetchBase(remote, candidate, cfg, cwd)) {
          branch = candidate;
          break;
        }
      }
    }
    const theirsRef = branch ? `refs/remotes/${remote}/${branch}` : null;
    if (!branch || !theirsRef || !refExists(theirsRef, cwd)) return done([], "skipped", `no ${remote} base branch to compare with`);

    const label = `${remote}/${branch}`;
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const tip of [...new Set(tips)]) {
      for (const f of await analyseTip(tip, theirsRef, label, cwd)) {
        const key = `${f.ruleId}\0${f.file}\0${f.line}\0${f.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(f);
        }
      }
    }
    return done(findings, "ok", [`compared with ${label}`, note].filter(Boolean).join("; "));
  } catch (err) {
    return done([], "skipped", `could not analyse: ${(err as Error).message.split("\n")[0]}`);
  }
}
