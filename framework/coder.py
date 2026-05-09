"""Coder agent: takes a GitHub Issue and writes code, then opens a PR."""
import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from framework.config import CLAUDE_BIN, PROJECT_ROOT, PROMPTS_DIR
from framework.github import create_pr, get_issue


def slugify(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\[r\d+\]\s*", "", title)
    title = re.sub(r"[^a-z0-9]+", "-", title)
    return title.strip("-")[:50]


def git(args: list[str]) -> str:
    result = subprocess.run(["git"] + args, capture_output=True, text=True, cwd=PROJECT_ROOT)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", type=int, required=True)
    args = parser.parse_args()

    issue = get_issue(args.issue)
    print(f"Working on issue #{issue['number']}: {issue['title']}")

    branch = f"feature/issue-{issue['number']}-{slugify(issue['title'])}"
    git(["checkout", "main"])
    git(["pull", "origin", "main", "--rebase"])
    git(["checkout", "-b", branch])
    print(f"Created branch: {branch}")

    system = (PROMPTS_DIR / "coder.txt").read_text()
    (PROJECT_ROOT / "extension").mkdir(exist_ok=True)

    task = (
        f"Implement GitHub Issue #{issue['number']}: {issue['title']}\n\n"
        f"{issue['body']}\n\n"
        f"Write all necessary files into the extension/ directory. "
        f"Read existing files before modifying them. "
        f"Follow conventions in CLAUDE.md."
    )

    print("Running Claude Code coder agent...")
    result = subprocess.run(
        [CLAUDE_BIN, "--print", "--system-prompt", system, task],
        cwd=PROJECT_ROOT
    )

    if result.returncode != 0:
        print("Claude Code exited with error.", file=sys.stderr)
        sys.exit(1)

    status = git(["status", "--porcelain"])
    if not status:
        print("No changes written.")
        sys.exit(0)

    git(["add", "extension/"])
    git(["commit", "-m", f"feat: {issue['title']} (closes #{issue['number']})"])
    git(["push", "-u", "origin", branch])

    pr_body = (
        f"Closes #{issue['number']}\n\n"
        f"## Changes\nImplements: {issue['title']}\n\n"
        f"## Original Issue\n{issue['body']}"
    )
    pr_number = create_pr(title=issue["title"], body=pr_body)
    print(f"\nOpened PR #{pr_number}: https://github.com/noloss/promptsentinel/pull/{pr_number}")


if __name__ == "__main__":
    main()
