import subprocess

from training.szz import bug_inducing_pairs


def sha_of(repo, subject):
    out = subprocess.run(["git", "log", "--format=%H %s"], cwd=repo, capture_output=True, text=True, check=True).stdout
    return next(line.split(" ", 1)[0] for line in out.splitlines() if line.split(" ", 1)[1] == subject)


def test_fix_commit_points_back_to_the_planted_bug(fixture_repo):
    fix = sha_of(fixture_repo, "Fix discount percentage bug")
    inducer = sha_of(fixture_repo, "Add discount support")
    assert bug_inducing_pairs(fixture_repo, [fix]) == {(inducer, "app/calc.py")}
