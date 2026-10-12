# Push Safety Score

Every push gets one number from **0 to 100**, which decides whether it goes through.

```
score = round(100 × (1 − (0.6 × bugRisk + 0.4 × conflictRisk)))
```

| Situation | Decision |
|---|---|
| Any secret found | **BLOCK**, score 0. Can't be overridden (except Git's own `--no-verify`) |
| score ≥ 70 | **ALLOW** |
| 40 ≤ score < 70 | **ALLOW WITH WARNINGS**: the push goes through, the reasons are printed |
| score < 40 | **BLOCK**: can be overridden once with `PREFLUX_FORCE=1`, which is recorded |

## The two inputs

**bugRisk (0–1)** comes from the push's **riskiest file**, using the ML model's calibrated probability *p* and its "high" cut-off *t* (about 0.19 for the current model):

```
bugRisk = min(1, p / (2t))
```
A file exactly at the high cut-off gives 0.5; twice the cut-off or more gives 1. Raw probabilities aren't used directly, because calibrated bug probabilities are small (the average change is about 15%), which would make the score barely move.

**conflictRisk (0–1)** is the sum over conflict findings, capped at 1: a **high** conflict counts 1.0 (Git would merge it silently), a **medium** one 0.5 (Git will flag it anyway, or a duplicate definition).

## What that means in practice

| Push | bugRisk | conflictRisk | Score | Decision |
|---|---|---|---|---|
| Clean, low-risk change | 0.25 | 0 | 85 | ALLOW |
| One high conflict with a teammate's work | low | 1.0 | ≈ 60 | WARN |
| A very risky file (≥ 2× the high cut-off), no conflict | 1.0 | 0 | 40 | WARN |
| Risky file **and** a conflict | 1.0 | 1.0 | 0 | **BLOCK** |
| Moderately risky file and a conflict | 0.75 | 1.0 | 15 | **BLOCK** |
| Contains an API key | – | – | 0 | **BLOCK** (secrets) |

One warning signal alone (a conflict, *or* a risky change) warns. Two together block. Feature branches are expected to diverge from `main`, and the ML model is a prediction (ROC-AUC 0.75), so blocking on either signal alone would stop too many good pushes.

## Fail-open

If the ML service is unreachable, or the conflict check can't run, that input counts as **n/a** and doesn't lower the score. The report shows `bug risk n/a`. Only the secret check fails closed.

## Overriding a score block

```powershell
$env:PREFLUX_FORCE=1; git push      # PowerShell
```
```bash
PREFLUX_FORCE=1 git push             # bash
```
Or `preflux scan --force` for a manual scan. The report says **PUSH ALLOWED (FORCED)**, and the JSON report has `"forced": true`, so the Phase 5 dashboard can show overrides. Secrets can never be forced.

## Configuration (`.prefluxrc.json`)

```json
"score": {
  "weights": { "bugRisk": 0.6, "conflictRisk": 0.4 },
  "thresholds": { "allow": 70, "warn": 40 }
}
```
A team that wants to be stricter can raise the thresholds, e.g. `{ "allow": 90, "warn": 70 }` makes a single high conflict block.

Code: `packages/cli/src/score/pushSafetyScore.ts` · tests: `packages/cli/test/score.test.ts` and the "Push Safety Score" block in `test/e2e.test.ts`.
