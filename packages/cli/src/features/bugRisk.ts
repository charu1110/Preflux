import type { Finding, ModuleResult, Severity } from "@preflux/shared";
import { MAX_ROWS_PER_PUSH, type FeatureRow, type RiskLevel } from "@preflux/shared/ml";
import { predict } from "../api/mlClient.js";
import type { MlConfig } from "../config.js";
import type { RevisionSet } from "../git/range.js";
import { extractFeatures } from "./extract.js";

const LEVEL_SEVERITY: Record<RiskLevel, Severity> = { high: "high", medium: "medium", low: "low" };

export interface BugRiskResult {
  findings: Finding[];
  module: ModuleResult;
}

function skipped(reason: string, started: number): BugRiskResult {
  return { findings: [], module: { status: "skipped", reason, durationMs: Math.round(performance.now() - started) } };
}

/**
 * Extract change features locally, ask the ML service for probabilities, and report the riskiest
 * change per file. Informational only: bug risk never blocks a push on its own (Phase 4 adds the
 * Push Safety Score). Fails open: any problem means "skipped", never an error.
 */
export async function runBugRisk(sets: RevisionSet[], root: string, ml: MlConfig): Promise<BugRiskResult> {
  const started = performance.now();
  if (!ml.enabled) return skipped("disabled in .prefluxrc.json", started);

  let rows: FeatureRow[] = [];
  let truncated = false;
  try {
    for (const s of sets) {
      const r = extractFeatures(s.revArgs, root);
      rows.push(...r.rows);
      truncated ||= r.truncated;
    }
  } catch (err) {
    return skipped(`could not read git history: ${(err as Error).message}`, started);
  }
  if (rows.length > MAX_ROWS_PER_PUSH) {
    rows = rows.slice(rows.length - MAX_ROWS_PER_PUSH);
    truncated = true;
  }
  if (rows.length === 0) return skipped("no JavaScript/TypeScript/Python files changed", started);

  const result = await predict(
    ml.url,
    rows.map((r, i) => ({ id: `r${i}`, features: r.features })),
    ml.timeoutMs,
  );
  if (!result.ok) return skipped(result.reason, started);

  // Riskiest change per file.
  const byFile = new Map<string, { row: FeatureRow; probability: number; level: RiskLevel }>();
  for (const p of result.data.rows) {
    const row = rows[Number(p.id.slice(1))];
    if (!row) continue;
    const prev = byFile.get(row.file);
    if (!prev || p.probability > prev.probability) byFile.set(row.file, { row, probability: p.probability, level: p.level });
  }

  const findings: Finding[] = [...byFile.values()]
    .sort((a, b) => b.probability - a.probability)
    .map(({ row, probability, level }) => ({
      kind: "bug_risk",
      ruleId: "bug-risk",
      severity: LEVEL_SEVERITY[level],
      message: `${Math.round(probability * 100)}% estimated chance this change introduces a bug (${level} risk)`,
      file: row.file,
      commit: row.commit,
      probability,
    }));

  return {
    findings,
    module: {
      status: "ok",
      reason: truncated ? `analysed the most recent ${MAX_ROWS_PER_PUSH} file changes` : undefined,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
