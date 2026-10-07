"""Mine public repositories into bug-risk feature rows, then SZZ-label them.

    python training/mine.py                      # every repo in training/repos.json
    python training/mine.py --repos requests     # just one
    python training/mine.py --repos koa --limit 300   # quick smoke run

Outputs (gitignored) in services/ml/data/:
    repos/<name>/              clones
    raw/<name>.csv             feature rows: repo, commit, file, timestamp, <features...>
    raw/<name>.fixes.txt       fix commits (subject matches the shared fix regex)
    raw/<name>.labels.csv      SZZ bug-inducing (commit, file) pairs
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from pydriller import Repository  # noqa: E402

from app.spec import load_spec  # noqa: E402
from training.features import HistoryAccumulator, commit_info_from_pydriller  # noqa: E402
from training.szz import bug_inducing_pairs  # noqa: E402

DATA = ML_ROOT / "data"
REPOS_FILE = Path(__file__).with_name("repos.json")


def ensure_clone(name: str, url: str) -> Path:
    dest = DATA / "repos" / name
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"[{name}] cloning {url}")
        # On Windows, verify TLS against the Windows certificate store (schannel) rather than
        # Git's bundled OpenSSL CA list, which misses corporate/antivirus root certificates.
        tls = ["-c", "http.sslBackend=schannel"] if os.name == "nt" else []
        subprocess.run(["git", *tls, "clone", "--quiet", url, str(dest)], check=True)
    return dest


def mine_repo(name: str, url: str, branch: str | None, limit: int | None) -> None:
    spec = load_spec()
    path = ensure_clone(name, url)
    raw = DATA / "raw"
    raw.mkdir(parents=True, exist_ok=True)

    acc = HistoryAccumulator(spec)
    fixes: list[str] = []
    rows_written = 0
    started = time.time()
    repo = Repository(str(path), only_no_merge=True, only_in_branch=branch)

    with (raw / f"{name}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["repo", "commit", "file", "timestamp", *spec.feature_order])
        for n, commit in enumerate(repo.traverse_commits(), 1):
            info, touched = commit_info_from_pydriller(commit, spec)
            if len(info.changes) > spec.max_files_per_commit:
                acc.update(info, touched)  # bulk/refactor commit: keep history, emit no rows
                continue
            for r in acc.process(info, touched):
                w.writerow([name, r["commit"], r["file"], r["timestamp"], *(r["features"][k] for k in spec.feature_order)])
                rows_written += 1
            if info.changes and spec.is_fix(info.subject):
                fixes.append(info.sha)
            if n % 500 == 0:
                print(f"[{name}] {n} commits, {rows_written} rows, {time.time() - started:.0f}s")
            if limit and n >= limit:
                break

    (raw / f"{name}.fixes.txt").write_text("\n".join(fixes) + "\n", encoding="utf-8")
    print(f"[{name}] mined {rows_written} rows, {len(fixes)} fix commits in {time.time() - started:.0f}s; running SZZ")

    pairs = bug_inducing_pairs(path, fixes, spec, verbose=True)
    with (raw / f"{name}.labels.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["commit", "file"])
        w.writerows(sorted(pairs))
    print(f"[{name}] done: {len(pairs)} bug-inducing pairs, total {time.time() - started:.0f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repos", help="comma-separated names from repos.json (default: all)")
    parser.add_argument("--limit", type=int, help="stop after N commits per repo (smoke runs)")
    args = parser.parse_args()

    repos = json.loads(REPOS_FILE.read_text(encoding="utf-8"))
    wanted = set(args.repos.split(",")) if args.repos else None
    for r in repos:
        if wanted is None or r["name"] in wanted:
            mine_repo(r["name"], r["url"], r.get("branch"), args.limit)


if __name__ == "__main__":
    main()
