"""Preflux ML service.

    uvicorn app.main:app --port 8000

GET  /health   service status, model version, expected features
POST /predict  bug-risk probability for each feature row

Requests carry only numeric features and opaque row ids: the CLI never sends file paths or code.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.model import BugRiskModel, load_model
from app.spec import load_spec

MAX_ROWS = 500
SPEC = load_spec()
FEATURES = frozenset(SPEC.feature_order)


class FeatureRowIn(BaseModel):
    id: Annotated[str, Field(min_length=1, max_length=64)]
    features: dict[str, float]

    @field_validator("features")
    @classmethod
    def exact_feature_set(cls, v: dict[str, float]) -> dict[str, float]:
        missing, extra = FEATURES - v.keys(), v.keys() - FEATURES
        if missing or extra:
            raise ValueError(f"missing features {sorted(missing)}, unexpected {sorted(extra)}")
        return v


class PredictRequest(BaseModel):
    rows: Annotated[list[FeatureRowIn], Field(min_length=1, max_length=MAX_ROWS)]


class RowOut(BaseModel):
    id: str
    probability: float
    level: Literal["low", "medium", "high"]


class PredictResponse(BaseModel):
    model_version: str
    threshold: float
    rows: list[RowOut]


state: dict[str, BugRiskModel | None] = {"model": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = load_model()
    yield


app = FastAPI(title="Preflux ML service", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    model = state["model"]
    return {
        "status": "ok" if model else "no_model",
        "model_version": model.version if model else None,
        "feature_spec_version": SPEC.version,
        "features": list(SPEC.feature_order),
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    model = state["model"]
    if model is None:
        raise HTTPException(503, "No trained model found. Run training/train.py to create models/bugrisk.json.")
    probabilities = model.predict([r.features for r in req.rows])
    return PredictResponse(
        model_version=model.version,
        threshold=model.threshold,
        rows=[RowOut(id=r.id, probability=round(float(p), 6), level=model.level(float(p))) for r, p in zip(req.rows, probabilities)],
    )
