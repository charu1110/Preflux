import { basename } from "node:path";
import type { ModuleResult, ScanRange, ScanReport } from "@preflux/shared";
import { loadConfig } from "../config.js";
import { addedLinesForRevisions, addedLinesStaged, type AddedLine } from "../git/diff.js";
import { repoRoot } from "../git/exec.js";
import { parsePrePushInput, readStdin } from "../git/prePushInput.js";
import { countCommits, revisionsForPushedRef, unpushedRevisions, type RevisionSet } from "../git/range.js";
import { renderReport } from "../report/terminal.js";
import { loadAllowlist } from "../secrets/allowlist.js";
import { scanAddedLines } from "../secrets/scanner.js";
import { VERSION } from "../version.js";

export interface ScanOptions {
  hook?: boolean;
  staged?: boolean;
  range?: string;
  json?: boolean;
  /** Pre-push hook arguments: remote name and URL. */
  remote?: string;
  cwd?: string;
  /** Pre-push stdin; read from process.stdin when omitted in hook mode. */
  stdin?: string;
}

const NOT_YET = (phase: string): ModuleResult => ({ status: "skipped", reason: `arrives in ${phase}`, durationMs: 0 });

async function resolveRevisions(opts: ScanOptions, root: string): Promise<RevisionSet[]> {
  if (opts.range) return [{ label: opts.range, revArgs: [opts.range] }];
  if (opts.hook) {
    const refs = parsePrePushInput(opts.stdin ?? (await readStdin()));
    return refs.map((r) => revisionsForPushedRef(r, opts.remote, root)).filter((r): r is RevisionSet => r !== null);
  }
  return [unpushedRevisions(root)];
}

export async function runScan(opts: ScanOptions): Promise<ScanReport> {
  const startedAt = new Date().toISOString();
  const root = repoRoot(opts.cwd ?? process.cwd());
  const config = loadConfig(root);
  const allowlist = loadAllowlist(root, config.secrets.ignorePaths);
  const mode: ScanReport["mode"] = opts.staged ? "staged" : opts.hook ? "hook" : "manual";

  const t0 = performance.now();
  let added: AddedLine[];
  let ranges: ScanRange[];
  if (opts.staged) {
    added = addedLinesStaged(root);
    ranges = [{ label: "staged", commits: 0 }];
  } else {
    const sets = await resolveRevisions(opts, root);
    added = sets.flatMap((s) => addedLinesForRevisions(s.revArgs, root));
    ranges = sets.map((s) => ({ label: s.label, commits: countCommits(s.revArgs, root) }));
  }
  const findings = scanAddedLines(added, allowlist, config.secrets.entropy);
  const secretsMs = Math.round(performance.now() - t0);

  return {
    version: 1,
    tool: { name: "preflux", version: VERSION },
    startedAt,
    mode,
    repo: basename(root),
    ranges,
    findings,
    score: null,
    // Hard override: any secret blocks the push, whatever the other modules say.
    decision: findings.some((f) => f.kind === "secret") ? "block" : "allow",
    forced: false,
    modules: {
      secrets: { status: "ok", durationMs: secretsMs },
      bugRisk: NOT_YET("Phase 2"),
      conflicts: NOT_YET("Phase 3"),
    },
  };
}

/** CLI wrapper: prints the report and returns the process exit code. */
export async function scanCommand(opts: ScanOptions): Promise<number> {
  try {
    const report = await runScan(opts);
    if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stderr.write(`${renderReport(report)}\n`);
    return report.decision === "block" ? 1 : 0;
  } catch (err) {
    process.stderr.write(`preflux: ${(err as Error).message}\n`);
    if (opts.hook) {
      // Fail closed: if we couldn't check for secrets, don't let the push through silently.
      process.stderr.write("preflux: push blocked because the secret scan could not run. Bypass once with: git push --no-verify\n");
      return 1;
    }
    return 2;
  }
}
