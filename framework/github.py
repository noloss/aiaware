"""Thin wrapper around gh CLI for issue and PR operations."""
import json
import subprocess
import sys
from framework.config import GH_BIN, GITHUB_REPO


def _run(args: list[str], check=True) -> subprocess.CompletedProcess:
    cmd = [GH_BIN] + args
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"gh error: {result.stderr}", file=sys.stderr)
        result.check_returncode()
    return result


def ensure_labels(labels: list[str]) -> None:
    """Create labels if they don't exist."""
    existing_raw = _run(["label", "list", "--repo", GITHUB_REPO, "--json", "name"]).stdout
    existing = {item["name"] for item in json.loads(existing_raw)}
    color_map = {
        "release-1": "0075ca", "release-2": "e4e669", "release-3": "d93f0b",
        "release-4": "0e8a16", "release-5": "5319e7", "release-6": "b60205",
        "ready": "c2e0c6", "needs-review": "fbca04", "needs-work": "e11d48",
        "LGTM": "0e8a16",
    }
    for label in labels:
        if label not in existing:
            color = color_map.get(label, "ededed")
            _run(["label", "create", label, "--repo", GITHUB_REPO, "--color", color], check=False)


def ensure_milestone(title: str) -> None:
    """Create milestone if it doesn't already exist."""
    raw = _run(["api", f"repos/{GITHUB_REPO}/milestones", "--jq", ".[].title"]).stdout
    if title not in raw.splitlines():
        _run(["api", f"repos/{GITHUB_REPO}/milestones", "--method", "POST",
              "-f", f"title={title}", "-f", "state=open"])


def create_issue(title: str, body: str, labels: list[str], milestone_title: str) -> int:
    """Create a GitHub issue and return its number."""
    args = ["issue", "create", "--repo", GITHUB_REPO,
            "--title", title, "--body", body]
    for label in labels:
        args += ["--label", label]
    args += ["--milestone", milestone_title]
    result = _run(args).stdout.strip()
    # result is the issue URL, extract number from end
    return int(result.rstrip("/").split("/")[-1])


def get_issue(number: int) -> dict:
    raw = _run(["issue", "view", str(number), "--repo", GITHUB_REPO,
                "--json", "title,body,labels,number"]).stdout
    return json.loads(raw)


def create_pr(title: str, body: str, base: str = "main") -> int:
    """Push current branch and open a PR, return PR number."""
    ensure_labels(["needs-review", "needs-work", "LGTM"])
    result = _run(["pr", "create", "--repo", GITHUB_REPO,
                   "--title", title, "--body", body,
                   "--base", base, "--label", "needs-review"]).stdout.strip()
    return int(result.rstrip("/").split("/")[-1])


def get_pr_diff(pr_number: int) -> str:
    return _run(["pr", "diff", str(pr_number), "--repo", GITHUB_REPO]).stdout


def get_pr(pr_number: int) -> dict:
    raw = _run(["pr", "view", str(pr_number), "--repo", GITHUB_REPO,
                "--json", "title,body,number,headRefName"]).stdout
    return json.loads(raw)


def approve_pr(pr_number: int, comment: str) -> None:
    _run(["pr", "review", str(pr_number), "--repo", GITHUB_REPO,
          "--approve", "--body", comment])


def request_changes(pr_number: int, comment: str) -> None:
    # GitHub doesn't allow requesting changes on your own PR, so post a comment instead
    _run(["pr", "comment", str(pr_number), "--repo", GITHUB_REPO,
          "--body", f"**🔴 CHANGES REQUESTED**\n\n{comment}"])
    _run(["pr", "edit", str(pr_number), "--repo", GITHUB_REPO,
          "--add-label", "needs-work", "--remove-label", "needs-review"], check=False)


def approve_pr(pr_number: int, comment: str) -> None:
    # GitHub doesn't allow approving your own PR, so post a comment instead
    _run(["pr", "comment", str(pr_number), "--repo", GITHUB_REPO,
          "--body", f"**✅ LGTM**\n\n{comment}"])


def merge_pr(pr_number: int) -> None:
    _run(["pr", "merge", str(pr_number), "--repo", GITHUB_REPO,
          "--squash", "--delete-branch"])
