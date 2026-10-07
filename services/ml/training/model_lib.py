"""Shared training utilities: time-ordered splits, XGBoost training, threshold tuning, metrics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from app.model import calibrate
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    brier_score_loss,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

XGB_PARAMS: dict[str, Any] = {
    "n_estimators": 500,
    "max_depth": 5,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "tree_method": "hist",
    "eval_metric": "aucpr",
    "random_state": 42,
}
EARLY_STOPPING_ROUNDS = 50


@dataclass
class Split:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame


def time_split(df: pd.DataFrame, train: float = 0.7, val: float = 0.1) -> Split:
    """Per repo: oldest `train` share for training, next `val` share for validation, newest for test.

    Splitting by time (not randomly) mirrors real use: the model only ever sees the past.
    """
    parts: dict[str, list[pd.DataFrame]] = {"train": [], "val": [], "test": []}
    for _, g in df.groupby("repo", sort=True):
        g = g.sort_values("timestamp", kind="stable")
        n = len(g)
        a, b = int(n * train), int(n * (train + val))
        parts["train"].append(g.iloc[:a])
        parts["val"].append(g.iloc[a:b])
        parts["test"].append(g.iloc[b:])
    return Split(**{k: pd.concat(v, ignore_index=True) for k, v in parts.items()})


def xy(df: pd.DataFrame, features: tuple[str, ...]) -> tuple[np.ndarray, np.ndarray]:
    return df[list(features)].to_numpy(dtype=np.float32), df["buggy"].to_numpy(dtype=np.int32)


def train_xgb(train: pd.DataFrame, val: pd.DataFrame, features: tuple[str, ...], **overrides: Any) -> xgb.XGBClassifier:
    x_tr, y_tr = xy(train, features)
    x_va, y_va = xy(val, features)
    pos = max(1, int(y_tr.sum()))
    params = {**XGB_PARAMS, "scale_pos_weight": (len(y_tr) - pos) / pos, **overrides}
    model = xgb.XGBClassifier(early_stopping_rounds=EARLY_STOPPING_ROUNDS, **params)
    model.fit(x_tr, y_tr, eval_set=[(x_va, y_va)], verbose=False)
    return model


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_platt(y_true: np.ndarray, raw: np.ndarray) -> dict[str, float]:
    """Platt scaling: calibrated = sigmoid(a * logit(raw) + b), fitted on held-out data.

    scale_pos_weight rebalances the classes during training, which pushes raw scores towards 0.5.
    Calibration maps them back to real probabilities (their average matches the true bug rate)
    without changing the ranking.
    """
    lr = LogisticRegression(C=1e6, max_iter=1000)
    lr.fit(_logit(raw).reshape(-1, 1), y_true)
    return {"method": "platt", "a": float(lr.coef_[0][0]), "b": float(lr.intercept_[0])}


apply_calibration = calibrate  # the API applies the exact same function


def best_f1_threshold(y_true: np.ndarray, proba: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, proba)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    # precision/recall have one more entry than thresholds
    return float(thresholds[int(np.argmax(f1[:-1]))]) if len(thresholds) else 0.5


def classification_metrics(y_true: np.ndarray, proba: np.ndarray, threshold: float) -> dict[str, Any]:
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    has_both = len(np.unique(y_true)) == 2
    return {
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, proba)) if has_both else None,
        "pr_auc": float(average_precision_score(y_true, proba)) if has_both else None,
        "positive_rate": float(y_true.mean()),
        "mean_predicted": float(proba.mean()),
        "brier": float(brier_score_loss(y_true, np.clip(proba, 0, 1))),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "n": int(len(y_true)),
    }


def risk_levels(threshold: float, base_rate: float) -> dict[str, float]:
    """Cut-offs shown to developers (on the calibrated scale):
    low = below the average bug rate, medium = above average, high = at/above the tuned threshold.
    """
    medium = base_rate if base_rate < threshold else threshold * 0.6
    return {"medium": round(medium, 6), "high": round(threshold, 6)}
