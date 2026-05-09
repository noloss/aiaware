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


def review_pr(pr_number: int) -> tuple[str, str]:
    """Review a PR. Returns (verdict, comment) where verdict is LGTM or CHANGES_REQUESTED."""
    pr = get_pr(pr_number)
    print(f"\n[reviewer] PR #{pr['number']}: {pr['title']}")

    diff = get_pr_diff(pr_number)
    if not diff:
        return "CHANGES_REQUESTED", "Empty diff – nothing was implemented."

    MAX_DIFF = 20_000
    if len(diff) > MAX_DIFF:
        diff = diff[:MAX_DIFF] + "\n\n[diff truncated]"

    system = (PROMPTS_DIR / "reviewer.txt").read_text()
    prompt = (
        f"## PR #{pr['number']}: {pr['title']}\n\n"
        f"### PR Description\n{pr['body']}\n\n"
        f"### Git Diff\n```diff\n{diff}\n```"
    )

    print("[reviewer] Sending to Claude...")
    raw = call_claude(prompt, system)

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        review = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[reviewer] Failed to parse JSON: {e}\nRaw: {raw[:300]}", file=sys.stderr)
        return "CHANGES_REQUESTED", f"Reviewer error – could not parse response: {raw[:200]}"

    verdict = review.get("verdict", "").upper()
    comment = review.get("comment", "")

    print(f"[reviewer] Verdict: {verdict}")
    print(f"[reviewer] Comment: {comment}")

    if verdict == "LGTM":
        approve_pr(pr_number, comment)
        print(f"[reviewer] Approved PR #{pr_number}. Merging...")
        merge_pr(pr_number)
        print("[reviewer] Merged.")
    elif verdict == "CHANGES_REQUESTED":
        request_changes(pr_number, comment)
        print(f"[reviewer] Requested changes on PR #{pr_number}.")
    else:
        verdict = "CHANGES_REQUESTED"
        comment = f"Unexpected verdict from reviewer: {raw[:200]}"

    return verdict, comment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", type=int, required=True)
    args = parser.parse_args()
    review_pr(args.pr)


if __name__ == "__main__":
    main()
