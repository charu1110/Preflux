import pytest

from training.extract_features import iter_rows
from training.features import FileChange, change_entropy, count_lines, git_subject


def test_extractor_matches_golden_fixture(fixture_repo, expected_rows):
    rows = list(iter_rows(fixture_repo))
    assert [(r["commit"], r["file"]) for r in rows] == [(r["commit"], r["file"]) for r in expected_rows]
    for got, want in zip(rows, expected_rows):
        assert got["features"] == pytest.approx(want["features"], abs=1e-9)


def test_hand_checked_values_for_the_fix_commit(fixture_repo):
    rows = list(iter_rows(fixture_repo))
    fix = next(r for r in rows if r["features"]["is_fix"] == 1)
    f = fix["features"]
    assert fix["file"] == "app/calc.py"
    assert (f["la"], f["ld"]) == (1, 1)  # one line changed
    assert f["nuc"] == 3  # initial, discount, formatting commits
    assert f["ndev"] == 2  # alice + bob
    assert f["exp"] == 1  # Bob@Preflux.TEST is bob@preflux.test: 1 prior commit
    assert f["age_days"] == pytest.approx(9 + 18.25 / 24)  # Jan 10 14:00 -> Jan 20 08:15


def test_rename_counts_as_new_file_and_deletion_has_no_row(fixture_repo):
    rows = list(iter_rows(fixture_repo))
    renamed = next(r for r in rows if r["file"] == "web/fmt.ts")["features"]
    assert renamed["nuc"] == 0 and renamed["la"] == renamed["loc"] == 7
    legacy = [r for r in rows if r["file"] == "app/legacy.py"]
    assert len(legacy) == 1  # added in the first commit; its deletion produces no row


def test_helpers():
    assert count_lines("") == 0
    assert count_lines("a") == 1
    assert count_lines("a\n") == 1
    assert count_lines("a\nb") == 2
    assert change_entropy((FileChange("a", 5, 0, 5),)) == 0
    assert change_entropy((FileChange("a", 5, 0, 5), FileChange("b", 3, 2, 3))) == pytest.approx(1.0)
    assert git_subject("Fix crash\non start\n\nlong body") == "Fix crash on start"
