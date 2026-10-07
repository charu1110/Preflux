# Bug-risk model evaluation

Model `bugrisk-v1-20261004`, trained 2026-10-04T16:35:15+00:00 on axios, express, flask, httpie, koa, requests.
Rows: 14700 train / 2099 validation / 4205 test (time-ordered per repository). Bug-inducing rate: 14.6%.
Decision threshold 0.194 (tuned for F1 on validation).

## Test set (newest 20% of each repository)

| Model | Precision | Recall | F1 | ROC-AUC | PR-AUC |
|---|---|---|---|---|---|
| XGBoost (Preflux) | 0.213 | 0.578 | 0.311 | 0.754 | 0.248 |
| Logistic regression | 0.211 | 0.610 | 0.313 | 0.760 | 0.274 |
| Size heuristic (la+ld > 100) | 0.245 | 0.128 | 0.168 | 0.542 | 0.117 |

XGBoost confusion matrix: TP 240, FP 889, FN 175, TN 2901.

**Calibration.** Probabilities shown to developers are Platt-calibrated on the validation split. On the test split the average predicted risk is 14.4% against an actual bug-inducing rate of 9.9% (Brier score 0.085).

## Leave-one-project-out (train on the others, test on this one)

| Held-out repository | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|
| axios | 0.439 | 0.322 | 0.372 | 0.702 |
| express | 0.322 | 0.143 | 0.198 | 0.681 |
| flask | 0.271 | 0.434 | 0.334 | 0.718 |
| httpie | 0.282 | 0.461 | 0.350 | 0.719 |
| koa | 0.242 | 0.429 | 0.310 | 0.681 |
| requests | 0.231 | 0.363 | 0.282 | 0.682 |

## Feature importance (XGBoost gain)

| Feature | Gain share |
|---|---|
| `la` | 0.405 |
| `nf` | 0.102 |
| `ld` | 0.076 |
| `ndev` | 0.075 |
| `nuc` | 0.067 |
| `loc` | 0.063 |
| `is_fix` | 0.053 |
| `prior_fixes` | 0.046 |
| `exp` | 0.042 |
| `age_days` | 0.040 |
| `entropy` | 0.033 |

## Notes

- Labels come from SZZ, which is noisy: some "fix" commits aren't bug fixes and some inducing commits are misattributed.
- The newest 180 days of each repository are excluded (right-censoring: those changes had no time to be fixed).
- Published just-in-time defect prediction models typically reach F1 around 0.3–0.5; ROC-AUC is the more stable comparison.
- Both learned models clearly beat the size heuristic. XGBoost and logistic regression perform about the same here: with 11 change-level features the signal is mostly monotonic (bigger, more scattered, more fix-prone changes are riskier), which a linear model on log-scaled features already captures.
- A 24-configuration hyperparameter search (depth 3–6, min_child_weight 5–50, learning rate 0.02–0.05), scored on the validation split only, plateaued at validation PR-AUC 0.30–0.31. Performance is limited by the features and the label noise, not by tuning.
- The test split was used once, for this report; the threshold, calibration and early stopping use validation only.
- The newest period has a lower SZZ bug rate than older history (its fixes have had less time to appear), so calibrated probabilities slightly over-estimate risk for very recent code. Treat them as relative risk, not exact odds.
