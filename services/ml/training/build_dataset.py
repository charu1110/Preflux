"""Join mined feature rows with SZZ labels into the training dataset.

    python training/build_dataset.py            # -> datasets/jit_v1.csv.gz

Right-censoring: a change made in the last CENSOR_DAYS of a repo's history has not had time to
be fixed yet, so an absent SZZ label there means "unknown", not "clean". Those rows are dropped.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from app.spec import load_spec  # noqa: E402

RAW = ML_ROOT / "data" / "raw"
DEFAULT_OUT = ML_ROOT / "datasets" / "jit_v1.csv.gz"
CENSOR_DAYS = 180


def label_repo(name: str, censor_days: int = CENSOR_DAYS) -> pd.DataFrame:
    rows = pd.read_csv(RAW / f"{name}.csv", dtype={"commit": str, "file": str})
    labels = pd.read_csv(RAW / f"{name}.labels.csv", dtype=str)
    inducing = set(zip(labels["commit"], labels["file"]))
    rows["buggy"] = [int((c, f) in inducing) for c, f in zip(rows["commit"], rows["file"])]
    cutoff = rows["timestamp"].max() - censor_days * 86_400
    return rows[rows["timestamp"] <= cutoff].reset_index(drop=True)


def build(names: list[str], out: Path = DEFAULT_OUT) -> pd.DataFrame:
    spec = load_spec()
    frames = [label_repo(n) for n in names if (RAW / f"{n}.labels.csv").exists()]
    if not frames:
        raise SystemExit("no mined repos found in data/raw; run training/mine.py first")
    df = pd.concat(frames, ignore_index=True)
    df = df[["repo", "commit", "file", "timestamp", *spec.feature_order, "buggy"]]
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False, compression="gzip")
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    names = [r["name"] for r in json.loads((Path(__file__).with_name("repos.json")).read_text(encoding="utf-8"))]
    df = build(names, args.out)
    summary = df.groupby("repo").agg(rows=("buggy", "size"), buggy=("buggy", "sum"))
    summary["buggy_%"] = (100 * summary["buggy"] / summary["rows"]).round(1)
    print(summary.to_string())
    print(f"\ntotal {len(df)} rows, {df['buggy'].sum()} buggy ({100 * df['buggy'].mean():.1f}%) -> {args.out}")
    print(f"size {args.out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
