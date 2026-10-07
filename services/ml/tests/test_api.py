import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.spec import load_spec

FEATURES = load_spec().feature_order


def row(i, **overrides):
    return {"id": f"r{i}", "features": {**dict.fromkeys(FEATURES, 1.0), **overrides}}


@pytest.fixture
def client(trained_model_dir, monkeypatch):
    monkeypatch.setenv("PREFLUX_MODEL_DIR", str(trained_model_dir))
    with TestClient(app) as c:
        yield c


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["model_version"].startswith("bugrisk-v1")
    assert body["features"] == list(FEATURES)


def test_predict_returns_rows_in_order(client):
    res = client.post("/predict", json={"rows": [row(1), row(2, la=390, prior_fixes=9)]})
    assert res.status_code == 200
    body = res.json()
    assert [r["id"] for r in body["rows"]] == ["r1", "r2"]
    assert all(0 <= r["probability"] <= 1 and r["level"] in {"low", "medium", "high"} for r in body["rows"])
    assert body["rows"][1]["probability"] > body["rows"][0]["probability"]


@pytest.mark.parametrize(
    "payload",
    [
        {"rows": []},
        {"rows": [{"id": "x", "features": {"la": 1}}]},  # missing features
        {"rows": [row(1, file_path=3.0)]},  # unexpected feature
        {"rows": [row(i) for i in range(501)]},  # too many rows
    ],
)
def test_predict_rejects_bad_payloads(client, payload):
    assert client.post("/predict", json=payload).status_code == 422


def test_predict_without_model_is_503(tmp_path, monkeypatch):
    monkeypatch.setenv("PREFLUX_MODEL_DIR", str(tmp_path))
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "no_model"
        assert c.post("/predict", json={"rows": [row(1)]}).status_code == 503
