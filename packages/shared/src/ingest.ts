import type { Decision, Finding, FindingKind, ScanReport, Severity } from "./index";

// What the CLI uploads to the dashboard (POST /api/ingest). Deliberately smaller than ScanReport:
// no masked snippets, no fingerprints, no commit messages. Only what the team dashboard shows.

export interface IngestFinding {
  kind: FindingKind;
  ruleId: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  reasons?: string[];
  probability?: number;
  percentile?: number;
}

export interface IngestPayload {
  branch?: string;
  headSha?: string;
  author?: string;
  mode: ScanReport["mode"];
  score: number | null;
  decision: Decision;
  blockedBy?: "secrets" | "score" | null;
  forced: boolean;
  bugRisk?: number | null;
  conflictRisk?: number | null;
  toolVersion: string;
  findings: IngestFinding[];
}

export const MAX_INGEST_FINDINGS = 300;

function toIngestFinding(f: Finding): IngestFinding {
  return {
    kind: f.kind,
    ruleId: f.ruleId,
    severity: f.severity,
    file: f.file,
    line: f.line,
    message: f.message,
    reasons: f.reasons,
    probability: f.probability,
    percentile: f.percentile,
  };
}

export function toIngestPayload(report: ScanReport, extra: { branch?: string; headSha?: string; author?: string }): IngestPayload {
  return {
    ...extra,
    mode: report.mode,
    score: report.score,
    decision: report.decision,
    blockedBy: report.blockedBy ?? null,
    forced: report.forced,
    bugRisk: report.scoreBreakdown?.bugRisk ?? null,
    conflictRisk: report.scoreBreakdown?.conflictRisk ?? null,
    toolVersion: report.tool.version,
    findings: report.findings.slice(0, MAX_INGEST_FINDINGS).map(toIngestFinding),
  };
}

const KINDS = new Set(["secret", "bug_risk", "conflict"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const DECISIONS = new Set(["allow", "warn", "block"]);
const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const isOptStr = (v: unknown, max: number) => v === undefined || v === null || isStr(v, max);
const isOptNum = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));

/** Server-side check of an upload. Returns an error message, or null when the payload is valid. */
export function validateIngestPayload(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "body must be a JSON object";
  const p = body as Record<string, unknown>;
  if (!DECISIONS.has(p.decision as string)) return "decision must be allow, warn or block";
  if (!(p.score === null || (Number.isInteger(p.score) && (p.score as number) >= 0 && (p.score as number) <= 100))) return "score must be 0-100";
  if (!isOptStr(p.branch, 200) || !isOptStr(p.headSha, 64) || !isOptStr(p.author, 120)) return "branch/headSha/author too long";
  if (!isOptNum(p.bugRisk) || !isOptNum(p.conflictRisk)) return "bugRisk/conflictRisk must be numbers";
  if (!Array.isArray(p.findings) || p.findings.length > MAX_INGEST_FINDINGS) return `findings must be an array of at most ${MAX_INGEST_FINDINGS}`;
  for (const f of p.findings as Array<Record<string, unknown>>) {
    if (typeof f !== "object" || f === null) return "each finding must be an object";
    if (!KINDS.has(f.kind as string) || !SEVERITIES.has(f.severity as string)) return "finding kind/severity invalid";
    if (!isStr(f.ruleId, 80) || !isStr(f.file, 300) || !isStr(f.message, 500)) return "finding ruleId/file/message missing or too long";
    if (!(f.line === undefined || f.line === null || Number.isInteger(f.line))) return "finding line must be an integer";
    if (!isOptNum(f.probability) || !isOptNum(f.percentile)) return "finding probability/percentile must be numbers";
    if (!(f.reasons === undefined || (Array.isArray(f.reasons) && f.reasons.every((r) => isStr(r, 200))))) return "finding reasons must be short strings";
  }
  return null;
}
