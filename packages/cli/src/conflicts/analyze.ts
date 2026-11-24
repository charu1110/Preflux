import type { Finding, ModuleResult } from "@preflux/shared";
import type { ConflictsConfig } from "../config.js";
import { readBlobs } from "../git/blobs.js";
import { git, gitStatus, tryGit } from "../git/exec.js";
import { findCollisions, findConflicts, type SideFile } from "./compare.js";
import { languageFor } from "./parser.js";
import { fileStructure } from "./symbols.js";

// Structural conflict detection against the team's integration branch (e.g. origin/main).
// Plus the Collision Radar: the same functions changed on teammates' unmerged branches.
// Fail-open: any problem means "skipped", never a blocked push.

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

/**
 * Bring <remote>/<branch> up to date; with the radar on, every branch (pruning deleted ones).
 * Returns a note when we have to fall back to the last known state.
 */
function fetchRemote(remote: string, branch: string, cfg: ConflictsConfig, cwd: string): string | undefined {
  if (!cfg.fetch) return undefined;
  const args = cfg.radar.enabled
    ? ["fetch", "--quiet", "--no-tags", "--prune", remote, `+refs/heads/*:refs/remotes/${remote}/*`]
    : ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`];
  try {
    git(args, cwd, { timeoutMs: cfg.fetchTimeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return undefined;
  } catch {
    return `could not fetch ${remote}; used the last known state`;
  }
}

const isAncestor = (a: string, b: string, cwd: string) => gitStatus(["merge-base", "--is-ancestor", a, b], cwd).status === 0;

interface TeamBranch {
  ref: string;
  /** Short name, e.g. "feature/coupons". */
  name: string;
  author: string;
}

/** Teammates' active, unmerged branches on the remote, newest first. */
function teamBranches(remote: string, baseBranch: string, ours: string, cfg: ConflictsConfig, cwd: string): TeamBranch[] {
  const me = (tryGit(["config", "user.email"], cwd) ?? "").trim().toLowerCase();
  const since = Date.now() / 1000 - cfg.radar.activeDays * 86_400;
  const prefix = `refs/remotes/${remote}/`;
  const baseRef = `${prefix}${baseBranch}`;
  const out = git(["for-each-ref", "--sort=-committerdate", "--format=%(refname)%1f%(committerdate:unix)%1f%(authorname)%1f%(authoremail)", prefix], cwd);

  const branches: TeamBranch[] = [];
  for (const line of lines(out)) {
    if (branches.length >= cfg.radar.maxBranches) break;
    const [ref = "", when = "0", author = "", email = ""] = line.split("\u001f");
    const name = ref.slice(prefix.length);
    if (name === "HEAD" || ref === baseRef || Number(when) < since) continue;
    if (email.replace(/[<>]/g, "").toLowerCase() === me) continue; // your own branches
    if (isAncestor(ref, ours, cwd) || isAncestor(ref, baseRef, cwd)) continue; // already in your work, or merged
    branches.push({ ref, name, author });
  }
  return branches;
}

/** Collision Radar for one pushed tip: same functions changed on teammates' branches. */
async function radarTip(tip: string, branches: TeamBranch[], cwd: string): Promise<Finding[]> {
  const ours = git(["rev-parse", tip], cwd).trim();
  const findings: Finding[] = [];
  for (const b of branches) {
    const theirs = git(["rev-parse", b.ref], cwd).trim();
    const base = tryGit(["merge-base", ours, theirs], cwd)?.trim();
    if (!base) continue;
    const changed = (to: string) => new Set(lines(git(["diff", "--name-only", "--no-renames", base, to], cwd)).filter((p) => languageFor(p)));
    const mine = changed(ours);
    const both = [...changed(theirs)].filter((p) => mine.has(p)).slice(0, MAX_FILES_PER_SIDE);
    if (both.length === 0) continue; // only parse files you've both touched
    const specs = [...new Set(both.flatMap((p) => [`${base}:${p}`, `${ours}:${p}`, `${theirs}:${p}`]))];
    const contents = readBlobs(specs, cwd);
    const blobs = new Map(specs.map((s, i) => [s, contents[i] ?? null]));
    findings.push(...findCollisions(await sideFiles(both, base, ours, blobs), await sideFiles(both, base, theirs, blobs), b.author, b.name));
  }
  return findings;
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
  return analyseCommits(git(["rev-parse", tip], cwd).trim(), git(["rev-parse", theirsRef], cwd).trim(), label, cwd);
}

/** What merging `theirs` into `ours` (both commit shas) would produce. Also used by the merge study. */
export async function analyseCommits(ours: string, theirs: string, label: string, cwd: string): Promise<Finding[]> {
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
      note = fetchRemote(remote, branch, cfg, cwd);
    } else if (cfg.fetch) {
      // Fresh clone without remote-tracking refs yet: try the usual names.
      for (const candidate of ["main", "master"]) {
        if (!fetchRemote(remote, candidate, cfg, cwd) && refExists(`refs/remotes/${remote}/${candidate}`, cwd)) {
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
    const keep = (f: Finding) => {
      const key = `${f.ruleId}\0${f.file}\0${f.line}\0${f.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(f);
      }
    };
    let radarCount = 0;
    for (const tip of [...new Set(tips)]) {
      const vsMain = await analyseTip(tip, theirsRef, label, cwd);
      vsMain.forEach(keep);
      if (cfg.radar.enabled) {
        const branches = teamBranches(remote, branch, git(["rev-parse", tip], cwd).trim(), cfg, cwd);
        radarCount = Math.max(radarCount, branches.length);
        // A teammate's branch often contains work already merged to main: don't warn twice about it.
        const known = new Set(vsMain.map((f) => `${f.file}\0${f.line}`));
        for (const f of await radarTip(tip, branches, cwd)) if (!known.has(`${f.file}\0${f.line}`)) keep(f);
      }
    }
    const compared = cfg.radar.enabled
      ? `compared with ${label} and ${radarCount} teammate branch${radarCount === 1 ? "" : "es"}`
      : `compared with ${label}`;
    return done(findings, "ok", [compared, note].filter(Boolean).join("; "));
  } catch (err) {
    return done([], "skipped", `could not analyse: ${(err as Error).message.split("\n")[0]}`);
  }
}
