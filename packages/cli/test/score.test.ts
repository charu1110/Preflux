import { DEFAULT_SCORE_CONFIG, type Finding, type ModuleResult, type Severity } from "@preflux/shared";
import { describe, expect, it } from "vitest";
import { bugRiskComponent, conflictComponent, pushSafetyScore } from "../src/score/pushSafetyScore.js";

const ok: ModuleResult = { status: "ok", durationMs: 1 };
const skipped: ModuleResult = { status: "skipped", reason: "service down", durationMs: 1 };

const risk = (probability: number, file = "a.js"): Finding => ({
  kind: "bug_risk", ruleId: "bug-risk", severity: "low", message: "", file, probability,
});
const conflict = (severity: Severity): Finding => ({ kind: "conflict", ruleId: "conflict-same-function", severity, message: "", file: "a.js" });
const secret: Finding = { kind: "secret", ruleId: "aws-access-key-id", severity: "critical", message: "", file: "a.js" };

// The real model's "high" cut-off is ~0.19 (calibrated); tests use 0.2 for round numbers.
const score = (findings: Finding[], modules: { bug?: ModuleResult; conflicts?: ModuleResult } = {}) =>
  pushSafetyScore({
    findings,
    bugRiskModule: modules.bug ?? ok,
    conflictsModule: modules.conflicts ?? ok,
    bugRiskThreshold: 0.2,
    config: DEFAULT_SCORE_CONFIG,
  });

describe("score components", () => {
  it("scales bug risk so the model's high cut-off is 0.5 and twice it is 1", () => {
    expect(bugRiskComponent([], 0.2)).toBe(0);
    expect(bugRiskComponent([risk(0.1)], 0.2)).toBe(0.25);
    expect(bugRiskComponent([risk(0.2)], 0.2)).toBe(0.5);
    expect(bugRiskComponent([risk(0.05), risk(0.55, "b.js")], 0.2)).toBe(1); // worst file counts
  });

  it("adds up conflicts: high = 1, medium = 0.5, capped at 1", () => {
    expect(conflictComponent([])).toBe(0);
    expect(conflictComponent([conflict("medium")])).toBe(0.5);
    expect(conflictComponent([conflict("high")])).toBe(1);
    expect(conflictComponent([conflict("medium"), conflict("medium"), conflict("medium")])).toBe(1);
  });
});

describe("Push Safety Score decisions", () => {
  it("allows a clean push with a perfect score", () => {
    expect(score([])).toMatchObject({ score: 100, decision: "allow", blockedBy: null });
  });

  it("allows an ordinary low-risk change", () => {
    expect(score([risk(0.1)])).toMatchObject({ score: 85, decision: "allow" });
  });

  it("warns (but allows) on one high conflict alone", () => {
    expect(score([conflict("high")])).toMatchObject({ score: 60, decision: "warn", conflictRisk: 1 });
  });

  it("warns (but allows) on very high bug risk alone", () => {
    expect(score([risk(0.55)])).toMatchObject({ score: 40, decision: "warn", bugRisk: 1 });
  });

  it("blocks when high bug risk and a conflict come together", () => {
    expect(score([risk(0.55), conflict("high")])).toMatchObject({ score: 0, decision: "block", blockedBy: "score" });
    expect(score([risk(0.3), conflict("high")])).toMatchObject({ score: 15, decision: "block", blockedBy: "score" });
  });

  it("always blocks secrets with score 0, whatever else happened", () => {
    expect(score([secret])).toMatchObject({ score: 0, decision: "block", blockedBy: "secrets" });
  });

  it("doesn't penalise modules that were skipped (fail-open)", () => {
    expect(score([], { bug: skipped, conflicts: skipped })).toMatchObject({ score: 100, decision: "allow", bugRisk: null, conflictRisk: null });
    expect(score([conflict("high")], { bug: skipped })).toMatchObject({ score: 60, decision: "warn", bugRisk: null });
  });

  it("respects custom thresholds from .prefluxrc.json", () => {
    const strict = pushSafetyScore({
      findings: [conflict("high")],
      bugRiskModule: ok,
      conflictsModule: ok,
      config: { ...DEFAULT_SCORE_CONFIG, thresholds: { allow: 90, warn: 70 } },
    });
    expect(strict).toMatchObject({ score: 60, decision: "block" });
  });
});
