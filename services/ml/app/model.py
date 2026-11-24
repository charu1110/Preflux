"""Loads the trained XGBoost booster and its metadata once, and scores feature rows."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import xgboost as xgb

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


@dataclass
class BugRiskModel:
    booster: xgb.Booster
    metadata: dict[str, Any]

    @property
    def version(self) -> str:
        return self.metadata["model_version"]

    @property
    def feature_order(self) -> list[str]:
        return self.metadata["feature_order"]

    @property
    def threshold(self) -> float:
        return float(self.metadata["threshold"])

    def level(self, probability: float) -> str:
        levels = self.metadata["levels"]
        if probability >= levels["high"]:
            return "high"
        if probability >= levels["medium"]:
            return "medium"
        return "low"

    def predict(self, rows: list[dict[str, float]]) -> np.ndarray:
        x = np.array([[row[name] for name in self.feature_order] for row in rows], dtype=np.float32)
        return self.predict_matrix(x)

    def predict_matrix(self, x: np.ndarray) -> np.ndarray:
        """Calibrated probabilities (see training/model_lib.py: fit_platt)."""
        return calibrate(self.booster.inplace_predict(x), self.metadata.get("calibration"))

    def percentile(self, probability: float) -> float | None:
        """Share of training changes (0-100) that the model rated as less risky than this one."""
        quantiles = self.metadata.get("training_quantiles")
        if not quantiles:
            return None
        return round(100 * float(np.searchsorted(quantiles, probability, side="right") - 1) / (len(quantiles) - 1), 1)

    def reasons(self, rows: list[dict[str, float]], top: int = 3) -> list[list[dict[str, float | str]]]:
        """The features that pushed each prediction *up* the most (XGBoost SHAP contributions).

        This is how the model answers "why is this change risky?": for each row, the per-feature
        contributions plus a bias add up to the model's raw score, so the largest positive ones
        are the real drivers of that particular prediction.
        """
        x = np.array([[row[name] for name in self.feature_order] for row in rows], dtype=np.float32)
        contribs = self.booster.predict(xgb.DMatrix(x), pred_contribs=True)[:, :-1]  # last column = bias
        out = []
        for row, values in zip(rows, contribs):
            ranked = sorted(((float(v), name) for name, v in zip(self.feature_order, values) if v > 0), reverse=True)
            out.append([{"feature": name, "value": float(row[name]), "impact": round(v, 4)} for v, name in ranked[:top]])
        return out


def calibrate(raw: np.ndarray, calibration: dict[str, float] | None) -> np.ndarray:
    """Platt scaling: sigmoid(a * logit(raw) + b). Identity when the model has no calibration."""
    if not calibration:
        return raw
    p = np.clip(raw, 1e-6, 1 - 1e-6)
    return 1 / (1 + np.exp(-(calibration["a"] * np.log(p / (1 - p)) + calibration["b"])))


def load_model(model_dir: Path | None = None) -> BugRiskModel | None:
    """Returns None when no trained model exists yet (the API then answers 503)."""
    directory = Path(os.environ.get("PREFLUX_MODEL_DIR", model_dir or DEFAULT_MODEL_DIR))
    model_file, meta_file = directory / "bugrisk.json", directory / "metadata.json"
    if not model_file.exists() or not meta_file.exists():
        return None
    booster = xgb.Booster()
    booster.load_model(str(model_file))
    return BugRiskModel(booster=booster, metadata=json.loads(meta_file.read_text(encoding="utf-8")))
