import { buildExplainInput, MAX_EXPLAIN_FINDINGS, type ExplainFinding, type ExplainPush } from "@preflux/shared/explain";
import { describe, expect, it } from "vitest";

const push: ExplainPush = { score: 26, decision: "block", blockedBy: "score", forced: false, branch: "my-change" };
const finding = (over: Partial<ExplainFinding> = {}): ExplainFinding => ({
  kind: "conflict",
  ruleId: "conflict-same-function",
  severity: "high",
  file: "lib/application.js",
  line: 228,
  message: "Application.createContext() was also edited on origin/master (ad6ec53 by Rahul).",
  reasons: null,
  ...over,
});

function report(input: string) {
  const json = /<push_report>\n([\s\S]*)\n<\/push_report>/.exec(input)?.[1];
  return JSON.parse(json ?? "null");
}

describe("buildExplainInput", () => {
  it("sends the decision, score and findings as tagged data", () => {
    const input = buildExplainInput(push, [finding(), finding({ kind: "bug_risk", ruleId: "bug-risk", line: null, reasons: ["60 people edited this file before"] })]);
    const r = report(input);
    expect(r.decision).toBe("block");
    expect(r.pushSafetyScore).toBe(26);
    expect(r.findings[0].location).toBe("lib/application.js:228");
    expect(r.findings[1]).toMatchObject({ location: "lib/application.js", why: ["60 people edited this file before"] });
  });

  it("marks a forced push so the explanation can say it was overridden", () => {
    expect(report(buildExplainInput({ ...push, forced: true }, [])).decision).toBe("block (overridden once by the developer)");
  });

  it("caps the number of findings and the length of each text", () => {
    const many = Array.from({ length: MAX_EXPLAIN_FINDINGS + 5 }, () => finding({ message: "x".repeat(1000) }));
    const r = report(buildExplainInput(push, many));
    expect(r.findings).toHaveLength(MAX_EXPLAIN_FINDINGS);
    expect(r.moreFindingsNotShown).toBe(5);
    expect(r.findings[0].message.length).toBeLessThanOrEqual(301);
  });

  it("contains only the stored fields: no snippets or fingerprints exist to leak", () => {
    const input = buildExplainInput(push, [finding({ kind: "secret", ruleId: "aws-access-key-id", severity: "critical", message: "AWS access key ID" })]);
    expect(Object.keys(report(input).findings[0]).sort()).toEqual(["kind", "location", "message", "rule", "severity"]);
  });
});
