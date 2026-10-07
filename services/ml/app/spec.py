"""Loads the shared bug-risk feature spec (packages/shared/src/ml/features.json).

The same JSON drives the TypeScript extractor in the CLI, so both sides agree on
feature order, the bug-fix regex and which files are analysed.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SPEC_PATH = REPO_ROOT / "packages" / "shared" / "src" / "ml" / "features.json"


@dataclass(frozen=True)
class FeatureSpec:
    version: int
    feature_order: tuple[str, ...]
    fix_regex: re.Pattern[str]
    extensions: tuple[str, ...]
    max_files_per_commit: int
    max_rows_per_push: int

    def is_analysed(self, path: str) -> bool:
        return path.lower().endswith(self.extensions)

    def is_fix(self, subject: str) -> bool:
        return self.fix_regex.search(subject) is not None


@lru_cache(maxsize=1)
def load_spec() -> FeatureSpec:
    path = Path(os.environ.get("PREFLUX_FEATURE_SPEC", DEFAULT_SPEC_PATH))
    raw = json.loads(path.read_text(encoding="utf-8"))
    return FeatureSpec(
        version=raw["version"],
        feature_order=tuple(raw["featureOrder"]),
        fix_regex=re.compile(raw["fixRegex"], re.IGNORECASE),
        extensions=tuple(raw["extensions"]),
        max_files_per_commit=raw["maxFilesPerCommit"],
        max_rows_per_push=raw["maxRowsPerPush"],
    )
