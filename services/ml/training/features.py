"""Just-in-time (change-level) features for bug-risk prediction.

Definitions live in docs/features.md and must match packages/cli/src/features/extract.ts
exactly. The golden fixture test (fixtures/feature-repo.expected.json) enforces that.

One row = one (commit, file) pair, for analysed files that still exist after the commit.
"Prior" history means earlier non-merge commits, processed oldest first.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.spec import FeatureSpec, load_spec

if TYPE_CHECKING:  # pydriller is only needed when mining
    from pydriller import Commit

SECONDS_PER_DAY = 86_400


@dataclass(frozen=True)
class FileChange:
    path: str
    la: int
    ld: int
    loc: int


@dataclass(frozen=True)
class CommitInfo:
    sha: str
    email: str  # lower-cased
    timestamp: int  # author time, unix seconds
    subject: str  # first line of the message
    changes: tuple[FileChange, ...]  # analysed, non-deleted files, sorted by path


@dataclass
class _FileHistory:
    commits: int = 0
    authors: set[str] = field(default_factory=set)
    last_timestamp: int | None = None
    fixes: int = 0


def count_lines(content: str | bytes | None) -> int:
    """Number of lines: newline count, plus one for a final line without a trailing newline."""
    if not content:
        return 0
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")
    return content.count("\n") + (0 if content.endswith("\n") else 1)


def git_subject(message: str) -> str:
    """What `git log --format=%s` prints: the first paragraph, its lines joined by single spaces."""
    paragraph = message.strip().replace("\r\n", "\n").split("\n\n", 1)[0]
    return " ".join(line.strip() for line in paragraph.split("\n") if line.strip())


def change_entropy(changes: tuple[FileChange, ...]) -> float:
    """Normalised Shannon entropy of how a commit's changed lines spread across its files."""
    nf = len(changes)
    total = sum(c.la + c.ld for c in changes)
    if nf <= 1 or total == 0:
        return 0.0
    h = 0.0
    for c in changes:
        p = (c.la + c.ld) / total
        if p > 0:
            h -= p * math.log2(p)
    return h / math.log2(nf)


class HistoryAccumulator:
    """Walks commits oldest-first, emitting feature rows, then folding each commit into history."""

    def __init__(self, spec: FeatureSpec | None = None) -> None:
        self.spec = spec or load_spec()
        self._files: dict[str, _FileHistory] = {}
        self._author_commits: Counter[str] = Counter()

    def rows_for_commit(self, c: CommitInfo) -> list[dict[str, Any]]:
        is_fix = 1 if self.spec.is_fix(c.subject) else 0
        entropy = change_entropy(c.changes)
        exp = self._author_commits[c.email]
        rows = []
        for ch in c.changes:
            hist = self._files.get(ch.path, _FileHistory())
            age = 0.0 if hist.last_timestamp is None else max(0.0, (c.timestamp - hist.last_timestamp) / SECONDS_PER_DAY)
            features = {
                "la": ch.la,
                "ld": ch.ld,
                "nf": len(c.changes),
                "entropy": entropy,
                "nuc": hist.commits,
                "ndev": len(hist.authors),
                "age_days": age,
                "prior_fixes": hist.fixes,
                "exp": exp,
                "is_fix": is_fix,
                "loc": ch.loc,
            }
            rows.append({"commit": c.sha, "file": ch.path, "timestamp": c.timestamp, "features": features})
        return rows

    def update(self, c: CommitInfo, touched_paths: list[str] | None = None) -> None:
        """Record c in history. touched_paths defaults to c's analysed files."""
        is_fix = self.spec.is_fix(c.subject)
        for path in touched_paths if touched_paths is not None else [ch.path for ch in c.changes]:
            hist = self._files.setdefault(path, _FileHistory())
            hist.commits += 1
            hist.authors.add(c.email)
            hist.last_timestamp = c.timestamp
            if is_fix:
                hist.fixes += 1
        self._author_commits[c.email] += 1

    def process(self, c: CommitInfo, touched_paths: list[str] | None = None) -> list[dict[str, Any]]:
        rows = self.rows_for_commit(c)
        self.update(c, touched_paths)
        return rows


def _blob_after(commit: "Commit", path: str) -> bytes:
    """File content after the commit, read from its tree (like `git cat-file -p <sha>:<path>`).

    PyDriller's `source_code` is None for pure renames, so we don't rely on it.
    """
    try:
        return (commit._c_object.tree / path).data_stream.read()
    except KeyError:
        return b""


def commit_info_from_pydriller(commit: "Commit", spec: FeatureSpec | None = None) -> tuple[CommitInfo, list[str]]:
    """Convert a PyDriller commit. Returns the CommitInfo plus every analysed path the commit touched
    (including deletions and rename sources), which is what file history is keyed on.

    Renames are treated as delete(old) + add(new), matching `git --no-renames` in the CLI.
    """
    from pydriller import ModificationType

    spec = spec or load_spec()
    changes: list[FileChange] = []
    touched: list[str] = []
    for m in commit.modified_files:
        if m.change_type == ModificationType.DELETE:
            if m.old_path and spec.is_analysed(m.old_path):
                touched.append(m.old_path.replace("\\", "/"))
            continue
        path = (m.new_path or "").replace("\\", "/")
        if m.change_type == ModificationType.RENAME and m.old_path and spec.is_analysed(m.old_path):
            touched.append(m.old_path.replace("\\", "/"))
        if not spec.is_analysed(path):
            continue
        loc = count_lines(_blob_after(commit, path))
        if m.change_type in (ModificationType.RENAME, ModificationType.COPY):
            la, ld = loc, 0  # a new path: every line counts as added
        else:
            la, ld = m.added_lines, m.deleted_lines
        changes.append(FileChange(path=path, la=la, ld=ld, loc=loc))
        touched.append(path)

    changes.sort(key=lambda ch: ch.path)
    info = CommitInfo(
        sha=commit.hash,
        email=(commit.author.email or "").lower(),
        timestamp=int(commit.author_date.timestamp()),
        subject=git_subject(commit.msg or ""),
        changes=tuple(changes),
    )
    return info, touched
