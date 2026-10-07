"""Extract bug-risk feature rows for every commit of a repository.

Used to generate the golden parity fixture and for ad-hoc inspection:
    python training/extract_features.py --bundle ../../fixtures/feature-repo.bundle --out out.json
    python training/extract_features.py --repo path/to/repo --out out.json
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydriller import Repository  # noqa: E402

from training.features import HistoryAccumulator, commit_info_from_pydriller  # noqa: E402


def iter_rows(repo_path: str | Path) -> Iterator[dict[str, Any]]:
    """Yield feature rows oldest commit first. Every non-merge commit updates history."""
    acc = HistoryAccumulator()
    for commit in Repository(str(repo_path), only_no_merge=True).traverse_commits():
        info, touched = commit_info_from_pydriller(commit, acc.spec)
        yield from acc.process(info, touched)


def clone_bundle(bundle: Path) -> Path:
    dest = Path(tempfile.mkdtemp(prefix="preflux-bundle-")) / "repo"
    subprocess.run(["git", "clone", "-q", str(bundle), str(dest)], check=True)
    return dest


def extract(repo: Path | None = None, bundle: Path | None = None) -> list[dict[str, Any]]:
    if bundle is not None:
        repo = clone_bundle(bundle)
        try:
            return list(iter_rows(repo))
        finally:
            shutil.rmtree(repo.parent, ignore_errors=True)
    assert repo is not None
    return list(iter_rows(repo))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--repo", type=Path)
    src.add_argument("--bundle", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    rows = extract(repo=args.repo, bundle=args.bundle)
    # Timestamps are an implementation detail of mining; the parity contract is commit/file/features.
    out = [{"commit": r["commit"], "file": r["file"], "features": r["features"]} for r in rows]
    args.out.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(out)} rows to {args.out}")


if __name__ == "__main__":
    main()
