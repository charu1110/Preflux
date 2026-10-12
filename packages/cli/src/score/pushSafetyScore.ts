import type { Decision, Finding, ModuleResult, ScoreConfig, Severity } from "@preflux/shared";

// Push Safety Score (synopsis objective 3): one 0-100 number per push.
//   score = round(100 * (1 - (wBug * bugRisk + wConflict * conflictRisk)))
//   any secret -> score 0, BLOCK (cannot be forced)
//   score >= thresholds.allow -> ALLOW, >= thresholds.warn -> WARN (push goes ahead), else BLOCK
// See docs/scoring.md.

/** How much one conflict finding contributes to conflictRisk (capped at 1). */
const CONFLICT_WEIGHT: Record<Severity, number> = { critical: 1, high: 1, medium: 0.5, low: 0.25 };

export interface ScoreInput {
  findings: Finding[];
  bugRiskModule: ModuleResult;
  conflictsModule: ModuleResult;
  /** The model's "high" cut-off (calibrated probability), from the ML service. */
  bugRiskThreshold?: number;
  config: ScoreConfig;
}

export interface ScoreResult {
  score: number;
  decision: Decision;
  /** 0-1, or null when the module was skipped (then it doesn't lower the score). */
  bugRisk: number | null;
  conflictRisk: number | null;
  blockedBy: "secrets" | "score" | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Bug risk of the push = its riskiest file, scaled so that the model's "high" threshold maps to
 * 0.5 and twice the threshold (or more) maps to 1. Raw calibrated probabilities are small
 * (the average change is ~15%), so using them directly would make the score almost insensitive.
 */
export function bugRiskComponent(findings: Finding[], threshold = 0.5): number {
  const worst = Math.max(0, ...findings.filter((f) => f.kind === "bug_risk").map((f) => f.probability ?? 0));
  return round2(clamp01(worst / (2 * (threshold > 0 ? threshold : 0.5))));
}

export function conflictComponent(findings: Finding[]): number {
  return round2(clamp01(findings.filter((f) => f.kind === "conflict").reduce((sum, f) => sum + CONFLICT_WEIGHT[f.severity], 0)));
}

export function pushSafetyScore(input: ScoreInput): ScoreResult {
  const { findings, config } = input;
  const bugRisk = input.bugRiskModule.status === "ok" ? bugRiskComponent(findings, input.bugRiskThreshold) : null;
  const conflictRisk = input.conflictsModule.status === "ok" ? conflictComponent(findings) : null;

  if (findings.some((f) => f.kind === "secret")) {
    return { score: 0, decision: "block", bugRisk, conflictRisk, blockedBy: "secrets" };
  }
  const penalty = config.weights.bugRisk * (bugRisk ?? 0) + config.weights.conflictRisk * (conflictRisk ?? 0);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - penalty))));
  const decision: Decision = score >= config.thresholds.allow ? "allow" : score >= config.thresholds.warn ? "warn" : "block";
  return { score, decision, bugRisk, conflictRisk, blockedBy: decision === "block" ? "score" : null };
}
