"""Train the XGBoost bug-risk model and save it for the FastAPI service.

    python training/train.py                     # datasets/jit_v1.csv.gz -> models/

Writes models/bugrisk.json (XGBoost booster) and models/metadata.json (feature order,
decision threshold, risk levels, metrics, training data summary).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from app.spec import load_spec  # noqa: E402
from training.model_lib import (  # noqa: E402
    XGB_PARAMS,
    apply_calibration,
    fit_platt,
    best_f1_threshold,
    classification_metrics,
    risk_levels,
    time_split,
    train_xgb,
    xy,
)

DEFAULT_DATASET = ML_ROOT / "datasets" / "jit_v1.csv.gz"
DEFAULT_MODELS = ML_ROOT / "models"


def train_and_save(df: pd.DataFrame, out_dir: Path) -> dict[str, Any]:
    spec = load_spec()
    features = spec.feature_order
    split = time_split(df)
    model = train_xgb(split.train, split.val, features)

    # Calibrate and tune the threshold on validation; the test split is only used to report.
    x_va, y_va = xy(split.val, features)
    calibration = fit_platt(y_va, model.predict_proba(x_va)[:, 1])
    threshold = best_f1_threshold(y_va, apply_calibration(model.predict_proba(x_va)[:, 1], calibration))
    x_te, y_te = xy(split.test, features)
    test_metrics = classification_metrics(y_te, apply_calibration(model.predict_proba(x_te)[:, 1], calibration), threshold)

    trained_at = datetime.now(timezone.utc)
    metadata = {
        "model_version": f"bugrisk-v{spec.version}-{trained_at:%Y%m%d}",
        "feature_spec_version": spec.version,
        "feature_order": list(features),
        "calibration": calibration,
        "threshold": threshold,
        "levels": risk_levels(threshold, float(split.train["buggy"].mean())),
        "trained_at": trained_at.isoformat(timespec="seconds"),
        "best_iteration": int(model.best_iteration),
        "params": {k: v for k, v in XGB_PARAMS.items() if k != "eval_metric"},
        "data": {
            "repos": sorted(df["repo"].unique().tolist()),
            "rows": {"train": len(split.train), "val": len(split.val), "test": len(split.test)},
            "positive_rate": float(df["buggy"].mean()),
        },
        "test_metrics": test_metrics,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    # Early stopping keeps training past the best round; the sklearn wrapper predicts with the best
    # round, but a raw Booster (used by the API) would use every tree. Save only the selected trees.
    booster = model.get_booster()[: model.best_iteration + 1]
    booster.save_model(str(out_dir / "bugrisk.json"))
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--out", type=Path, default=DEFAULT_MODELS)
    args = parser.parse_args()

    df = pd.read_csv(args.dataset, dtype={"commit": str, "file": str})
    meta = train_and_save(df, args.out)
    m = meta["test_metrics"]
    print(f"{meta['model_version']}: threshold {meta['threshold']:.3f}, best iteration {meta['best_iteration']}")
    print(f"test  precision {m['precision']:.3f}  recall {m['recall']:.3f}  F1 {m['f1']:.3f}  ROC-AUC {m['roc_auc']:.3f}  PR-AUC {m['pr_auc']:.3f}")
    print(f"saved to {args.out}")


if __name__ == "__main__":
    main()
