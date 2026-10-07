from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "fixtures"


@pytest.fixture(scope="session")
def fixture_repo() -> Path:
    """The deterministic parity fixture, cloned from its bundle."""
    tmp = Path(tempfile.mkdtemp(prefix="preflux-pytest-"))
    repo = tmp / "repo"
    subprocess.run(["git", "clone", "-q", str(FIXTURES / "feature-repo.bundle"), str(repo)], check=True)
    yield repo
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="session")
def expected_rows() -> list[dict]:
    return json.loads((FIXTURES / "feature-repo.expected.json").read_text(encoding="utf-8"))


def synthetic_dataset(n_per_repo: int = 400, seed: int = 0) -> pd.DataFrame:
    """Two fake repos where bigger, fix-prone changes are more often buggy."""
    rng = np.random.default_rng(seed)
    frames = []
    for repo in ("alpha", "beta"):
        la = rng.integers(0, 400, n_per_repo)
        prior_fixes = rng.integers(0, 10, n_per_repo)
        risk = 1 / (1 + np.exp(-(la / 80 + prior_fixes / 3 - 4)))
        frames.append(
            pd.DataFrame(
                {
                    "repo": repo,
                    "commit": [f"{repo}{i:04d}" for i in range(n_per_repo)],
                    "file": "src/app.py",
                    "timestamp": 1_700_000_000 + np.arange(n_per_repo) * 3600,
                    "la": la,
                    "ld": rng.integers(0, 100, n_per_repo),
                    "nf": rng.integers(1, 10, n_per_repo),
                    "entropy": rng.random(n_per_repo),
                    "nuc": rng.integers(0, 50, n_per_repo),
                    "ndev": rng.integers(1, 8, n_per_repo),
                    "age_days": rng.random(n_per_repo) * 100,
                    "prior_fixes": prior_fixes,
                    "exp": rng.integers(0, 500, n_per_repo),
                    "is_fix": rng.integers(0, 2, n_per_repo),
                    "loc": rng.integers(10, 2000, n_per_repo),
                    "buggy": (rng.random(n_per_repo) < risk).astype(int),
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


@pytest.fixture(scope="session")
def trained_model_dir() -> Path:
    from training.train import train_and_save

    out = Path(tempfile.mkdtemp(prefix="preflux-model-"))
    train_and_save(synthetic_dataset(), out)
    yield out
    shutil.rmtree(out, ignore_errors=True)
