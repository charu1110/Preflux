import json

import numpy as np

from app.model import load_model
from tests.conftest import synthetic_dataset
from training.model_lib import time_split


def test_time_split_is_ordered_per_repo():
    split = time_split(synthetic_dataset())
    for repo in ("alpha", "beta"):
        train_max = split.train[split.train.repo == repo].timestamp.max()
        val = split.val[split.val.repo == repo].timestamp
        test = split.test[split.test.repo == repo].timestamp
        assert train_max < val.min() and val.max() < test.min()


def test_training_saves_a_loadable_model(trained_model_dir):
    meta = json.loads((trained_model_dir / "metadata.json").read_text())
    assert meta["feature_order"][0] == "la" and 0 < meta["threshold"] < 1
    assert meta["levels"]["medium"] < meta["levels"]["high"]
    assert meta["test_metrics"]["roc_auc"] > 0.7  # the synthetic signal is learnable

    model = load_model(trained_model_dir)
    # The saved booster holds exactly the early-stopped trees, so the API serves the validated model.
    assert model.booster.num_boosted_rounds() == meta["best_iteration"] + 1
    calm = dict.fromkeys(meta["feature_order"], 0.0)
    risky = {**calm, "la": 390.0, "prior_fixes": 9.0}
    p = model.predict([calm, risky])
    assert np.all((p >= 0) & (p <= 1)) and p[1] > p[0]
