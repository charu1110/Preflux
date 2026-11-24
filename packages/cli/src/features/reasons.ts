import type { FeatureName } from "@preflux/shared/ml";

// Turns the model's top contributing features into words a developer understands.
// The model decides *which* facts raised the risk; this only phrases them.

/** Contributions smaller than this (log-odds) barely move the prediction: not worth showing. */
export const MIN_IMPACT = 0.03;

function count(value: number, one: string, many = `${one}s`): string {
  const v = Math.round(value);
  return `${v} ${v === 1 ? one : many}`;
}

export function describeReason(feature: FeatureName, value: number): string {
  switch (feature) {
    case "la":
      return `big change (+${count(value, "line")})`;
    case "ld":
      return `${count(value, "line")} deleted`;
    case "nf":
      return `touches ${count(value, "file")} at once`;
    case "entropy":
      // Normalised 0..1. The model can raise risk for either end, so the words must follow the value.
      return value >= 0.5 ? "changes are spread evenly across several files" : "the whole change is concentrated in one file";
    case "nuc":
      return `this file was changed ${count(value, "time")} before`;
    case "ndev":
      return `${count(value, "person", "people")} edited this file before`;
    case "age_days":
      if (value < 1) return "this file was also changed less than a day ago";
      return value < 7 ? `this file was also changed ${count(value, "day")} ago` : `this file was last changed ${count(value, "day")} ago`;
    case "prior_fixes":
      return `this file needed ${count(value, "bug fix", "bug fixes")} before`;
    case "exp":
      return value < 20 ? `author is new to this repo (${count(value, "earlier commit")})` : `author has ${count(value, "commit")} here`;
    case "is_fix":
      return "this commit is itself a fix (fixes often introduce new bugs)";
    case "loc":
      return `large file (${count(value, "line")})`;
  }
}

export function describeReasons(reasons: Array<{ feature: FeatureName; value: number; impact: number }> | undefined): string[] {
  return (reasons ?? []).filter((r) => r.impact >= MIN_IMPACT).map((r) => describeReason(r.feature, r.value));
}
