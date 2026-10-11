import {
  FIX_REGEX,
  MAX_ROWS_PER_PUSH,
  isAnalysedFile,
  type FeatureRow,
  type FeatureVector,
} from "@preflux/shared/ml";
import { readBlobs } from "../git/blobs.js";
import { git, tryGit } from "../git/exec.js";

// Just-in-time bug-risk features, computed locally from git history.
// Definitions: docs/features.md. Must match services/ml/training/features.py exactly;
// test/features.test.ts checks both against fixtures/feature-repo.expected.json.
//
// Uses a constant number of git processes regardless of push size (process start-up is slow on
// Windows): one log for the pushed commits, one log to seed prior history, one cat-file batch.

const REC = "\u001e";
const SEP = "\u001f";
const SECONDS_PER_DAY = 86_400;

interface FileChange {
  path: string;
  la: number;
  ld: number;
}

interface CommitDiff {
  sha: string;
  email: string;
  timestamp: number;
  subject: string;
  /** Analysed files that still exist after the commit, sorted by path. */
  changes: FileChange[];
  /** Every path the commit touched (incl. deletions); what file history is keyed on. */
  touched: string[];
}

export interface ExtractResult {
  rows: FeatureRow[];
  /** More rows than maxRows: only the most recent ones were kept. */
  truncated: boolean;
  commits: number;
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return n + (content.endsWith("\n") ? 0 : 1);
}

export function changeEntropy(changes: Array<{ la: number; ld: number }>): number {
  const nf = changes.length;
  const total = changes.reduce((s, c) => s + c.la + c.ld, 0);
  if (nf <= 1 || total === 0) return 0;
  let h = 0;
  for (const c of changes) {
    const p = (c.la + c.ld) / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(nf);
}

/** Parse `git log --raw --numstat --format=<REC>%H<SEP>%ae<SEP>%at<SEP>%s`. */
function parseCommits(out: string): CommitDiff[] {
  const commits: CommitDiff[] = [];
  for (const block of out.split(REC).slice(1)) {
    const lines = block.split("\n").map((l) => l.replace(/\r$/, ""));
    const [sha, email, at, subject] = (lines[0] ?? "").split(SEP);
    const deleted = new Set<string>();
    const numstat: FileChange[] = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith(":")) {
        // :100644 000000 abc123 000000 D\tpath
        const [meta, path] = line.split("\t");
        if (meta?.trim().endsWith(" D") && path) deleted.add(path);
      } else if (/^(\d+|-)\t(\d+|-)\t/.test(line)) {
        const [a, d, ...rest] = line.split("\t");
        numstat.push({ path: rest.join("\t"), la: a === "-" ? 0 : Number(a), ld: d === "-" ? 0 : Number(d) });
      }
    }
    commits.push({
      sha: sha ?? "",
      email: (email ?? "").toLowerCase(),
      timestamp: Number(at),
      subject: subject ?? "",
      changes: numstat
        .filter((n) => !deleted.has(n.path) && isAnalysedFile(n.path))
        .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
      touched: numstat.map((n) => n.path),
    });
  }
  return commits;
}

interface FileHistory {
  commits: number;
  authors: Set<string>;
  lastTimestamp: number | null;
  fixes: number;
}

/** Same algorithm as HistoryAccumulator in services/ml/training/features.py. */
class History {
  private files = new Map<string, FileHistory>();
  private authorCommits = new Map<string, number>();

  file(path: string): FileHistory {
    return this.files.get(path) ?? { commits: 0, authors: new Set(), lastTimestamp: null, fixes: 0 };
  }

  experience(email: string): number {
    return this.authorCommits.get(email) ?? 0;
  }

  /** Commits must be added oldest first. */
  add(email: string, timestamp: number, subject: string, touched: string[]): void {
    const isFix = FIX_REGEX.test(subject);
    for (const path of touched) {
      let h = this.files.get(path);
      if (!h) {
        h = { commits: 0, authors: new Set(), lastTimestamp: null, fixes: 0 };
        this.files.set(path, h);
      }
      h.commits++;
      h.authors.add(email);
      h.lastTimestamp = timestamp;
      if (isFix) h.fixes++;
    }
    this.authorCommits.set(email, this.experience(email) + 1);
  }
}

/** Seed history with every non-merge commit reachable from `base` (one git process). */
function seedHistory(base: string, cwd: string): History {
  const history = new History();
  const out = git(["log", "--reverse", "--no-merges", "--no-renames", "--name-only", `--format=${REC}%ae${SEP}%at${SEP}%s`, base], cwd);
  for (const block of out.split(REC).slice(1)) {
    const lines = block.split("\n").map((l) => l.replace(/\r$/, ""));
    const [email, at, subject] = (lines[0] ?? "").split(SEP);
    const touched = lines.slice(1).filter(Boolean);
    history.add((email ?? "").toLowerCase(), Number(at), subject ?? "", touched);
  }
  return history;
}

/** Feature rows for every (commit, analysed file) in the revision set, oldest commit first. */
export function extractFeatures(revArgs: string[], cwd: string, maxRows = MAX_ROWS_PER_PUSH): ExtractResult {
  const pushed = parseCommits(
    git(
      ["log", "--reverse", "--no-merges", "--no-renames", "--no-color", "--no-ext-diff", "--raw", "--numstat", `--format=${REC}%H${SEP}%ae${SEP}%at${SEP}%s`, ...revArgs],
      cwd,
    ),
  );
  if (pushed.length === 0) return { rows: [], truncated: false, commits: 0 };

  const base = tryGit(["rev-parse", "--verify", "-q", `${pushed[0]!.sha}^`], cwd)?.trim();
  const history = base ? seedHistory(base, cwd) : new History();

  const rows: FeatureRow[] = [];
  for (const c of pushed) {
    const isFix = FIX_REGEX.test(c.subject) ? 1 : 0;
    const entropy = changeEntropy(c.changes);
    const exp = history.experience(c.email);
    for (const ch of c.changes) {
      const h = history.file(ch.path);
      const features: FeatureVector = {
        la: ch.la,
        ld: ch.ld,
        nf: c.changes.length,
        entropy,
        nuc: h.commits,
        ndev: h.authors.size,
        age_days: h.lastTimestamp === null ? 0 : Math.max(0, (c.timestamp - h.lastTimestamp) / SECONDS_PER_DAY),
        prior_fixes: h.fixes,
        exp,
        is_fix: isFix,
        loc: 0, // filled below, only for rows we keep
      };
      rows.push({ commit: c.sha, file: ch.path, features });
    }
    history.add(c.email, c.timestamp, c.subject, c.touched);
  }

  // Keep the most recent rows: those are the changes the developer just made.
  const truncated = rows.length > maxRows;
  const kept = truncated ? rows.slice(rows.length - maxRows) : rows;
  const locs = readBlobs(kept.map((r) => `${r.commit}:${r.file}`), cwd).map((b) => (b === null ? 0 : countLines(b)));
  kept.forEach((r, i) => {
    r.features.loc = locs[i] ?? 0;
  });
  return { rows: kept, truncated, commits: pushed.length };
}
