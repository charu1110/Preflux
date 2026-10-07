"""SZZ labelling: find the commits that introduced the lines later changed by bug-fix commits.

Sliwerski, Zimmermann & Zeller (2005), "When do changes induce fixes?". For each fix commit we
`git blame` the lines it deleted or modified (PyDriller's get_commits_last_modified_lines); the
commits that last touched those lines are labelled bug-inducing for that file.

    python training/szz.py --repo data/repos/requests --fixes data/raw/requests.fixes.txt \
        --out data/raw/requests.labels.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydriller import Git, ModificationType  # noqa: E402

from app.spec import FeatureSpec, load_spec  # noqa: E402


def bug_inducing_pairs(
    repo_path: str | Path, fix_shas: Iterable[str], spec: FeatureSpec | None = None, verbose: bool = False
) -> set[tuple[str, str]]:
    """Return {(inducing_commit_sha, file_path)} for the analysed files touched by the given fix commits."""
    spec = spec or load_spec()
    gr = Git(str(repo_path))
    pairs: set[tuple[str, str]] = set()
    fix_shas = list(fix_shas)
    started = time.time()

    for i, sha in enumerate(fix_shas, 1):
        commit = gr.get_commit(sha)
        mods = [
            m
            for m in commit.modified_files
            # Only modified files have "old" lines to blame; added files can't point back to an inducer.
            if m.change_type == ModificationType.MODIFY and spec.is_analysed(m.new_path or "")
        ]
        if not mods or len(mods) > spec.max_files_per_commit:
            continue  # tangled mega-fixes add more noise than signal
        for m in mods:
            try:
                result = gr.get_commits_last_modified_lines(commit, m)
            except Exception as exc:  # blame can fail on odd histories; skip that file
                if verbose:
                    print(f"  skip {sha[:8]} {m.new_path}: {exc}", file=sys.stderr)
                continue
            for path, inducers in result.items():
                path = path.replace("\\", "/")
                for inducer in inducers:
                    if inducer != sha:
                        pairs.add((inducer, path))
        if verbose and i % 100 == 0:
            print(f"  szz {i}/{len(fix_shas)} fixes, {len(pairs)} pairs, {time.time() - started:.0f}s", file=sys.stderr)
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--fixes", type=Path, required=True, help="file with one fix-commit sha per line")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    fixes = [line.strip() for line in args.fixes.read_text().splitlines() if line.strip()]
    pairs = bug_inducing_pairs(args.repo, fixes, verbose=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["commit", "file"])
        w.writerows(sorted(pairs))
    print(f"{len(fixes)} fix commits -> {len(pairs)} bug-inducing (commit, file) pairs -> {args.out}")


if __name__ == "__main__":
    main()
