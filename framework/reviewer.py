"""Reviewer agent: reviews a PR and either approves or requests changes."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from framework.config import CLAUDE_BIN, PROMPTS_DIR
from framework.github import approve_pr, get_pr, get_pr_diff, merge_pr, request_changes


def call_claude(prompt: str, system: str) -> str:
    result = subprocess.run(
        [CLAUDE_BIN, "--print", "--output-format", "json",
         "--system-prompt", system, prompt],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Claude error: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    return data.get("result", data.get("content", ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", type=int, required=True, help="GitHub PR number")
    args = parser.parse_args()

    pr = get_pr(args.pr)
    print(f"Reviewing PR #{pr['number']}: {pr['title']}")

    diff = get_pr_diff(args.pr)
    if not diff:
        print("Empty diff — nothing to review.", file=sys.stderr)
        sys.exit(1)

    # Cap diff size to avoid hitting context limits
    MAX_DIFF = 20_000
    if len(diff) > MAX_DIFF:
        diff = diff[:MAX_DIFF] + "\n\n[diff truncated]"

    system = (PROMPTS_DIR / "reviewer.txt").read_text()
    prompt = (
        f"## PR #{pr['number']}: {pr['title']}\n\n"
        f"### PR Description\n{pr['body']}\n\n"
        f"### Git Diff\n```diff\n{diff}\n```"
    )

    print("Sending PR to Claude for review...")
    raw = call_claude(prompt, system)

    # Strip markdown fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        review = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Failed to parse Claude response as JSON: {e}", file=sys.stderr)
        print("Raw:", raw[:500], file=sys.stderr)
        sys.exit(1)

    verdict = review.get("verdict", "").upper()
    comment = review.get("comment", "")

    print(f"\nVerdict: {verdict}")
    print(f"Comment: {comment}")

    if verdict == "LGTM":
        approve_pr(args.pr, comment)
        print(f"\nApproved PR #{args.pr}. Merging...")
        merge_pr(args.pr)
        print("Merged.")
    elif verdict == "CHANGES_REQUESTED":
        request_changes(args.pr, comment)
        print(f"\nRequested changes on PR #{args.pr}.")
        print("Re-run coder: python framework/coder.py --issue <N>")
    else:
        print(f"Unexpected verdict '{verdict}', not taking action.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
