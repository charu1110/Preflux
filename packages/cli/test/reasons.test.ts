import { describe, expect, it } from "vitest";
import { describeReason, describeReasons } from "../src/features/reasons.js";

describe("plain-English risk reasons", () => {
  it("phrases each feature with its value", () => {
    expect(describeReason("la", 180)).toBe("big change (+180 lines)");
    expect(describeReason("la", 1)).toBe("big change (+1 line)");
    expect(describeReason("prior_fixes", 7)).toBe("this file needed 7 bug fixes before");
    expect(describeReason("prior_fixes", 1)).toBe("this file needed 1 bug fix before");
    expect(describeReason("ndev", 5)).toBe("5 people edited this file before");
    expect(describeReason("exp", 3)).toBe("author is new to this repo (3 earlier commits)");
    expect(describeReason("age_days", 0.4)).toBe("this file was also changed less than a day ago");
    expect(describeReason("entropy", 0.9)).toBe("changes are spread evenly across several files");
    expect(describeReason("entropy", 0)).toBe("the whole change is concentrated in one file");
    expect(describeReason("is_fix", 1)).toBe("this commit is itself a fix (fixes often introduce new bugs)");
  });

  it("keeps only reasons strong enough to matter, in the model's order", () => {
    expect(
      describeReasons([
        { feature: "la", value: 420, impact: 0.31 },
        { feature: "prior_fixes", value: 15, impact: 0.05 },
        { feature: "loc", value: 120, impact: 0.01 },
      ]),
    ).toEqual(["big change (+420 lines)", "this file needed 15 bug fixes before"]);
    expect(describeReasons(undefined)).toEqual([]);
  });
});
