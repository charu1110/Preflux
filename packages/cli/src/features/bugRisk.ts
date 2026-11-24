import type { Finding, ModuleResult, Severity } from "@preflux/shared";
import { MAX_ROWS_PER_PUSH, type FeatureRow, type PredictResponse, type RiskLevel } from "@preflux/shared/ml";
import { predict } from "../api/mlClient.js";
import type { MlConfig } from "../config.js";
import type { RevisionSet } from "../git/range.js";
import { extractFeatures } from "./extract.js";
import { describeReasons } from "./reasons.js";

const LEVEL_SEVERITY: Record<RiskLevel, Severity> = { high: "high", medium: "medium", low: "low" };

export interface BugRiskResult {
  findings: Finding[];
  module: ModuleResult;
  /** The model's "high" cut-off, used to scale bug risk in the Push Safety Score. */
  threshold?: number;
}

function skipped(reason: string, started: number): BugRiskResult {
  return { findings: [], module: { status: "skipped", reason, durationMs: Math.round(performance.now() - started) } };
}

/**
 * Extract change features locally, ask the ML service for probabilities, and report the riskiest
 * change per file. It feeds the Push Safety Score (score/pushSafetyScore.ts).
 * Fails open: any problem means "skipped" (and no score penalty), never an error.
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
  type Scored = PredictResponse["rows"][number] & { row: FeatureRow };
  const byFile = new Map<string, Scored>();
  for (const p of result.data.rows) {
    const row = rows[Number(p.id.slice(1))];
    if (!row) continue;
    const prev = byFile.get(row.file);
    if (!prev || p.probability > prev.probability) byFile.set(row.file, { ...p, row });
  }

  const findings: Finding[] = [...byFile.values()]
    .sort((a, b) => b.probability - a.probability)
    .map(({ row, probability, level, percentile, reasons }) => ({
      kind: "bug_risk",
      ruleId: "bug-risk",
      severity: LEVEL_SEVERITY[level],
      message:
        typeof percentile === "number"
          ? `${level} risk: riskier than ${Math.round(percentile)}% of past changes`
          : `${level} risk: ${Math.round(probability * 100)}% estimated chance of introducing a bug`,
      file: row.file,
      commit: row.commit,
      probability,
      percentile: typeof percentile === "number" ? percentile : undefined,
      reasons: describeReasons(reasons),
    }));

  return {
    findings,
    threshold: result.data.threshold,
    module: {
      status: "ok",
      reason: truncated ? `analysed the most recent ${MAX_ROWS_PER_PUSH} file changes` : undefined,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
