"""Build the deterministic fixture repo used by the bug-risk feature parity tests.

Produces fixtures/feature-repo.bundle: a small linear history with fixed authors and dates,
covering every feature edge case (new file, multi-file commit, planted bug + later fix,
rename, deletion, non-analysed file, upper-case author email).

Run with the ML venv:  services/ml/.venv/Scripts/python fixtures/build_feature_repo.py
Then regenerate the expected features:
    services/ml/.venv/Scripts/python services/ml/training/extract_features.py \
        --bundle fixtures/feature-repo.bundle --out fixtures/feature-repo.expected.json
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = HERE / "feature-repo.bundle"

ALICE = ("Alice Dev", "alice@preflux.test")
BOB = ("Bob Dev", "bob@preflux.test")
BOB_UPPER = ("Bob Dev", "Bob@Preflux.TEST")  # same person, different case: must count as one author

CALC_V1 = """def total(items):
    result = 0
    for price in items:
        result += price
    return result


def average(items):
    if not items:
        return 0
    return total(items) / len(items)
"""

# Planted bug: pct is a percentage (e.g. 10) but is used as a fraction.
CALC_V2 = CALC_V1 + """

def apply_discount(price, pct):
    if pct < 0:
        raise ValueError("negative discount")
    return price * (1 - pct)
"""

CALC_V3 = CALC_V2 + """

def round_price(value):
    return round(value, 2)
"""

CALC_V4 = CALC_V3.replace("return price * (1 - pct)", "return price * (1 - pct / 100)")

UTIL_V1 = """export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
"""

UTIL_V2 = UTIL_V1 + """
export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}
"""

UTIL_V3 = UTIL_V2.replace("return Math.min(hi, Math.max(lo, n));", "if (lo > hi) [lo, hi] = [hi, lo];\n  return Math.min(hi, Math.max(lo, n));")

FORMAT_V1 = """export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}
"""

LEGACY = """# Old helper kept for compatibility.
def legacy_total(items):
    return sum(items)
"""

# (date, author, subject, {path: content or None to delete}, [renames old->new])
COMMITS: list[tuple[str, tuple[str, str], str, dict[str, str | None], list[tuple[str, str]]]] = [
    ("2024-01-01T10:00:00+00:00", ALICE, "Initial commit",
     {"app/calc.py": CALC_V1, "web/util.ts": UTIL_V1, "app/legacy.py": LEGACY, "README.md": "# Demo\n"}, []),
    ("2024-01-05T09:30:00+00:00", BOB, "Add discount support",
     {"app/calc.py": CALC_V2}, []),
    ("2024-01-10T14:00:00+00:00", ALICE, "Add formatting helpers and mean",
     {"web/util.ts": UTIL_V2, "web/format.ts": FORMAT_V1, "app/calc.py": CALC_V3}, []),
    ("2024-01-20T08:15:00+00:00", BOB_UPPER, "Fix discount percentage bug",
     {"app/calc.py": CALC_V4}, []),
    ("2024-02-01T16:45:00+00:00", ALICE, "Clamp swaps reversed bounds; rename format module",
     {"web/util.ts": UTIL_V3}, [("web/format.ts", "web/fmt.ts")]),
    ("2024-02-03T11:00:00+00:00", BOB, "Remove legacy helper and update docs",
     {"app/legacy.py": None, "README.md": "# Demo\n\nPricing utilities.\n"}, []),
]


def git(repo: Path, *args: str, env: dict[str, str] | None = None) -> str:
    return subprocess.run(
        ["git", "-c", "core.autocrlf=false", *args], cwd=repo, env=env, check=True, capture_output=True, text=True
    ).stdout


def build(bundle: Path = BUNDLE) -> Path:
    work = Path(tempfile.mkdtemp(prefix="preflux-fixture-"))
    try:
        git(work, "init", "-q", "-b", "main")
        for date, (name, email), subject, files, renames in COMMITS:
            for old, new in renames:
                git(work, "mv", old, new)
            for path, content in files.items():
                target = work / path
                if content is None:
                    git(work, "rm", "-q", path)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8", newline="\n")
                git(work, "add", path)
            env = {
                **os.environ,
                "GIT_AUTHOR_NAME": name,
                "GIT_AUTHOR_EMAIL": email,
                "GIT_AUTHOR_DATE": date,
                "GIT_COMMITTER_NAME": name,
                "GIT_COMMITTER_EMAIL": email,
                "GIT_COMMITTER_DATE": date,
            }
            git(work, "commit", "-q", "-m", subject, env=env)
        if bundle.exists():
            bundle.unlink()
        git(work, "bundle", "create", str(bundle), "--all")
        return bundle
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    print(f"wrote {build()}")
