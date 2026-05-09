"""Coder agent: takes a GitHub Issue and writes code, then opens a PR."""
import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from framework.config import CLAUDE_BIN, GH_BIN, GITHUB_REPO, PROJECT_ROOT, PROMPTS_DIR
from framework.github import create_pr, get_issue


def slugify(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\[r\d+\]\s*", "", title)
    title = re.sub(r"[^a-z0-9]+", "-", title)
    return title.strip("-")[:50]


def git(args: list[str]) -> str:
    result = subprocess.run(["git"] + args, capture_output=True, text=True, cwd=PROJECT_ROOT)
    return result.stdout.strip()


def run_issue(issue_number: int, feedback: str | None = None) -> int:
    """Run coder for an issue. Returns PR number."""
    issue = get_issue(issue_number)
    print(f"\n[coder] Issue #{issue['number']}: {issue['title']}")

    branch = f"feature/issue-{issue['number']}-{slugify(issue['title'])}"
    existing_branch = branch in git(["branch", "--list", branch])

    if feedback and existing_branch:
        # Retry: checkout existing branch and amend
        git(["checkout", branch])
        print(f"[coder] Retrying on existing branch: {branch}")
    else:
        git(["checkout", "main"])
        git(["pull", "origin", "main", "--rebase"])
        git(["checkout", "-b", branch])
        print(f"[coder] Created branch: {branch}")

    system = (PROMPTS_DIR / "coder.txt").read_text()
    (PROJECT_ROOT / "extension").mkdir(exist_ok=True)

    task = f"Implement GitHub Issue #{issue['number']}: {issue['title']}\n\n{issue['body']}"
    if feedback:
        task += (
            f"\n\n## Reviewer feedback – fix these issues before finishing:\n{feedback}\n\n"
            f"Read existing files in extension/ first, then fix only what the reviewer flagged."
        )
    else:
        task += (
            "\n\nWrite all necessary files into the extension/ directory. "
            "Read existing files before modifying them. "
            "Follow conventions in CLAUDE.md."
        )

    print("[coder] Running Claude Code...")
    result = subprocess.run(
        [CLAUDE_BIN, "--print", "--dangerously-skip-permissions",
         "--system-prompt", system, task],
        cwd=PROJECT_ROOT
    )
    if result.returncode != 0:
        print("[coder] Claude Code exited with error.", file=sys.stderr)
        sys.exit(1)

    status = git(["status", "--porcelain"])
    if not status:
        print("[coder] No changes written – nothing to commit.")
        # Return existing open PR if there is one
        return 0

    git(["add", "extension/"])
    msg = f"fix: address review feedback (#{issue['number']})" if feedback else \
          f"feat: {issue['title']} (closes #{issue['number']})"
    git(["commit", "-m", msg])
    git(["push", "-u", "origin", branch])

    if not feedback:
        pr_body = (
            f"Closes #{issue['number']}\n\n"
            f"## Changes\nImplements: {issue['title']}\n\n"
            f"## Original Issue\n{issue['body']}"
        )
        pr_number = create_pr(title=issue["title"], body=pr_body)
        print(f"[coder] Opened PR #{pr_number}")
        return pr_number
    else:
        # PR already exists – find its number from gh
        raw = subprocess.run(
            [GH_BIN, "pr", "list", "--repo", GITHUB_REPO,
             "--head", branch, "--json", "number", "--jq", ".[0].number"],
            capture_output=True, text=True
        ).stdout.strip()
        pr_number = int(raw) if raw else 0
        print(f"[coder] Pushed fix to existing PR #{pr_number}")
        return pr_number


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", type=int, required=True)
    parser.add_argument("--feedback", type=str, default=None,
                        help="Reviewer feedback to address in a retry run")
    args = parser.parse_args()
    run_issue(args.issue, feedback=args.feedback)


if __name__ == "__main__":
    main()
