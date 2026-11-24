// One live call to Claude with a sample push (from the koa three-developer test), to check the key
// and see the wording. Costs one small request. Run from apps/web:
//   node --env-file=.env.local scripts/try-explain.ts
import { explainPush } from "../lib/ai/explain.ts";

const result = await explainPush(
  { score: 26, decision: "block", blockedBy: "score", forced: false, branch: "my-change" },
  [
    {
      kind: "bug_risk",
      ruleId: "bug-risk",
      severity: "high",
      file: "lib/application.js",
      line: null,
      message: "high risk: riskier than 75% of past changes",
      reasons: ["60 people edited this file before", "large file (361 lines)", "author is new to this repo (0 earlier commits)"],
    },
    {
      kind: "conflict",
      ruleId: "conflict-same-function",
      severity: "high",
      file: "lib/application.js",
      line: 228,
      message: "Application.createContext() was also edited on origin/master (ad6ec53 by Rahul). The edits don't overlap, so Git will merge them silently.",
      reasons: null,
    },
    {
      kind: "conflict",
      ruleId: "collision-branch",
      severity: "low",
      file: "lib/application.js",
      line: 254,
      message: "Priya is also changing Application.onerror() on branch priya/quiet-errors (not merged yet).",
      reasons: null,
    },
  ],
);
console.log(result.ok ? `model: ${result.model}\n\n${result.text}` : `error: ${result.error}`);
