// Shared contracts for every Preflux component.
// Findings that leave the developer's machine must only ever contain the fields below:
// never a raw secret value and never an absolute path.

export type FindingKind = "secret" | "bug_risk" | "conflict";

export type Severity = "low" | "medium" | "high" | "critical";

export type Decision = "allow" | "warn" | "block";

export interface Finding {
  kind: FindingKind;
  /** Stable rule identifier, e.g. "aws-access-key-id" or "high-entropy-base64". */
  ruleId: string;
  severity: Severity;
  /** Short human-readable description of the rule that fired. */
  message: string;
  /** Repo-relative path, forward slashes. */
  file: string;
  /** 1-indexed line in the version of the file that introduced the finding. */
  line?: number;
  /** Commit that introduced the finding ("STAGED" for staged-changes scans). */
  commit?: string;
  /** The offending line with the secret masked, truncated. */
  maskedSnippet?: string;
  /** Stable hash identifying this finding; can be used to allowlist it. */
  fingerprint?: string;
  /** Plain-English explanation (filled by the explanation layer in Phase 4). */
  explanation?: string;
}

export type ModuleName = "secrets" | "bugRisk" | "conflicts";

export interface ModuleResult {
  status: "ok" | "skipped" | "error";
  reason?: string;
  durationMs: number;
}

export interface ScanRange {
  /** Human-readable description, e.g. "refs/heads/main 1a2b3c4..5d6e7f8". */
  label: string;
  commits: number;
}

export interface ScanReport {
  version: 1;
  tool: { name: "preflux"; version: string };
  startedAt: string;
  mode: "hook" | "manual" | "staged";
  /** Repository folder name only (never an absolute path). */
  repo: string;
  ranges: ScanRange[];
  findings: Finding[];
  /** Push Safety Score 0-100; null until bug-risk and conflict modules exist. */
  score: number | null;
  decision: Decision;
  forced: boolean;
  modules: Record<ModuleName, ModuleResult>;
}

export interface ScoreConfig {
  weights: { bugRisk: number; conflictRisk: number };
  thresholds: { allow: number; warn: number };
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  weights: { bugRisk: 0.6, conflictRisk: 0.4 },
  thresholds: { allow: 70, warn: 40 },
};
