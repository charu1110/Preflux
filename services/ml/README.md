# Preflux ML service

A Python service that predicts the **bug risk** of a code change. It contains:
- **Training pipeline:** mine Git history → label it with SZZ → train XGBoost → evaluate.
- **FastAPI service:** serves the trained model to the `preflux` CLI.

Feature definitions are in [`docs/features.md`](../../docs/features.md), and the latest results in [`docs/ml-evaluation.md`](../../docs/ml-evaluation.md).

## Setup (Windows)
```bash
cd services/ml
python -m venv .venv
python -m pip --python "%CD%\.venv\Scripts\python.exe" install -r requirements.txt
```
The venv's bundled pip 22 can't verify TLS on machines where antivirus or a proxy inspects HTTPS. Installing through the global pip (25+, which trusts the Windows certificate store) avoids that. On macOS/Linux, `.venv/bin/pip install -r requirements.txt` is enough.

## Tests
```bash
.venv/Scripts/python -m pytest
```
These cover parity with the golden fixture, SZZ on a planted bug, a training smoke run, and the API contract.

## Run the service
```bash
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```
| Endpoint | |
|---|---|
| `GET /health` | `{status, model_version, features}`. `status` is `no_model` until a model has been trained |
| `POST /predict` | `{rows: [{id, features: {la, ld, …}}]}` (max 500 rows) → `{model_version, threshold, rows: [{id, probability, level}]}` |

The CLI calls `http://127.0.0.1:8000` by default. Override it with `PREFLUX_ML_URL`, or with `ml.url` in `.prefluxrc.json`. If the service is down, the CLI shows *bug risk skipped* and the push carries on.

Environment variables: `PREFLUX_MODEL_DIR` (default `models/`) and `PREFLUX_FEATURE_SPEC`.

## Rebuild the model
```bash
.venv/Scripts/python training/mine.py                       # clone + features + SZZ for repos.json (~1 h; repos can run in parallel)
.venv/Scripts/python training/mine.py --repos koa --limit 300   # quick smoke run
.venv/Scripts/python training/build_dataset.py              # -> datasets/jit_v1.csv.gz
.venv/Scripts/python training/train.py                      # -> models/bugrisk.json + metadata.json
.venv/Scripts/python training/evaluate.py                   # -> models/metrics.json + docs/ml-evaluation.md
```
Clones and raw CSVs live in `data/`, which is gitignored. The final dataset and model are committed so results can be reproduced.

## Regenerate the parity fixture
Do this only after an intentional change to the feature definitions:
```bash
.venv/Scripts/python ../../fixtures/build_feature_repo.py
.venv/Scripts/python training/extract_features.py --bundle ../../fixtures/feature-repo.bundle --out ../../fixtures/feature-repo.expected.json
```
