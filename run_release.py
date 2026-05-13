"""Orchestrator: run the full coder → reviewer loop for a release."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from framework.coder import run_issue
from framework.config import CLAUDE_BIN, GITHUB_REPO, PROMPTS_DIR
from framework.github import create_issue, ensure_labels, ensure_milestone, find_open_pr_for_issue, get_issue, is_issue_done, _run
from framework.reviewer import review_pr

MAX_RETRIES = 3
TEST_TIMEOUT = 120


def _resolve_node() -> str:
    """Return the path to the node binary, falling back to nvm-managed installs."""
    import shutil
    found = shutil.which("node")
    if found:
        return found
    nvm_dir = Path.home() / ".nvm" / "versions" / "node"
    if nvm_dir.is_dir():
        candidates = sorted(nvm_dir.glob("*/bin/node"), reverse=True)
        if candidates:
            return str(candidates[0])
    raise FileNotFoundError(
        "node not found on PATH and no nvm-managed install detected. "
        "Install Node.js 18+ or add it to PATH."
    )


def fetch_release_issues(release_number: str) -> list[dict]:
    """Fetch open+closed issues from GitHub with the release-N label."""
    label = f"release-{release_number}"
    raw = _run(["issue", "list", "--repo", GITHUB_REPO,
                "--label", label, "--state", "all",
                "--json", "number,title", "--limit", "100"]).stdout
    issues = json.loads(raw)
    return sorted(issues, key=lambda x: x["number"])


def split_issue(issue_number: int) -> list[int]:
    """Ask Claude to decompose a too-large issue into smaller sub-issues.

    Returns a list of newly created GitHub issue numbers.
    """
    issue = get_issue(issue_number)
    system = (PROMPTS_DIR / "splitter.txt").read_text()
    prompt = f"# Issue #{issue['number']}: {issue['title']}\n\n{issue['body']}"

    print(f"\n[splitter] Issue #{issue_number} is too large — asking Claude to split it...")
    try:
        result = subprocess.run(
            [CLAUDE_BIN, "--print", "--output-format", "json",
             "--system-prompt", system, prompt],
            capture_output=True, text=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        print("[splitter] Timed out generating split.", file=sys.stderr)
        return []

    if result.returncode != 0:
        print(f"[splitter] Claude error: {result.stderr[:200]}", file=sys.stderr)
        return []

    raw = json.loads(result.stdout).get("result", "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        sub_issues = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[splitter] Failed to parse response: {e}", file=sys.stderr)
        return []

    created = []
    for si in sub_issues:
        ms_title = si.get("milestone", "")
        if ms_title:
            ensure_milestone(ms_title)
        labels = si.get("labels", [])
        ensure_labels(labels)

        criteria_lines = []
        for ac in si.get("acceptance_criteria", []):
            criteria_lines.append(
                f"**Given** {ac['given']}  \n"
                f"**When** {ac['when']}  \n"
                f"**Then** {ac['then']}"
            )
        body = (
            f"## User Story\n{si['user_story']}\n\n"
            f"## Acceptance Criteria\n" + "\n\n".join(criteria_lines) +
            f"\n\n---\n_Split from issue #{issue_number}_"
        )
        number = create_issue(title=si["title"], body=body, labels=labels, milestone_title=ms_title)
        print(f"[splitter] Created sub-issue #{number}: {si['title']}")
        created.append(number)

    # Close the original oversized issue with a note.
    _run(["issue", "close", str(issue_number), "--repo", GITHUB_REPO,
          "--comment", f"Issue split into smaller sub-issues: {', '.join(f'#{n}' for n in created)}"])
    print(f"[splitter] Closed original issue #{issue_number}.")
    return created


def run_tests() -> tuple[bool, str]:
    """Run the local test suite. Returns (passed, combined output)."""
    print("\n[tests] Running test suite...")
    result = subprocess.run(
        [_resolve_node(), "--test"],
        cwd=Path(__file__).parent,
        capture_output=True,
        text=True,
        timeout=TEST_TIMEOUT,
    )
    output = result.stdout + result.stderr
    passed = result.returncode == 0
    print(f"[tests] {'PASS' if passed else 'FAIL'} (exit {result.returncode})")
    if not passed:
        print(output[-1000:])
    return passed, output


def process_issue(issue_number: int, release_number: str) -> None:
    """Run the full coder → reviewer loop for one issue, splitting if needed."""
    print(f"\n{'='*60}")
    print(f"Issue #{issue_number}")
    print(f"{'='*60}")

    if is_issue_done(issue_number):
        print(f"✓ Issue #{issue_number} already done, skipping.")
        return

    feedback = None
    pr_number = find_open_pr_for_issue(issue_number)
    if pr_number:
        print(f"Found existing PR #{pr_number}, resuming reviewer loop.")

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"\n--- Attempt {attempt}/{MAX_RETRIES} ---")

        if not pr_number:
            pr_number = run_issue(issue_number, feedback=feedback)

        if pr_number is None:
            # Coder got stuck (timeout or error) — split and requeue.
            sub_issues = split_issue(issue_number)
            if sub_issues:
                for sub in sub_issues:
                    process_issue(sub, release_number)
            else:
                print(f"\n✗ Issue #{issue_number}: coder stuck and split failed. Manual fix needed.", file=sys.stderr)
            return

        if not pr_number:
            print(f"Coder produced no PR for issue #{issue_number}, skipping.")
            return

        try:
            passed, test_output = run_tests()
        except subprocess.TimeoutExpired:
            passed, test_output = False, "[tests] Timed out after 120s"

        if not passed:
            if attempt < MAX_RETRIES:
                print("\nTests failed — sending output to coder for fixes...")
                feedback = (
                    "The test suite failed. Fix the failing tests before finishing.\n\n"
                    f"Test output (last 2000 chars):\n{test_output[-2000:]}"
                )
                pr_number = None
                continue
            else:
                print(
                    f"\n✗ Issue #{issue_number}: tests still failing after {MAX_RETRIES} attempts. "
                    f"Review PR #{pr_number} manually.",
                    file=sys.stderr,
                )
                return

        verdict, comment = review_pr(pr_number)

        if verdict == "LGTM":
            print(f"\n✓ Issue #{issue_number} done (PR #{pr_number} merged).")
            return

        if attempt < MAX_RETRIES:
            print(f"\nRetrying with reviewer feedback...")
            feedback = comment
            pr_number = None
        else:
            print(
                f"\n✗ Issue #{issue_number} still needs work after {MAX_RETRIES} attempts. "
                f"Review PR #{pr_number} manually.",
                file=sys.stderr
            )


def run_release(release_number: str) -> None:
    release_tasks = fetch_release_issues(release_number)

    if not release_tasks:
        print(f"No issues found with label 'release-{release_number}'.", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== Release {release_number}: {len(release_tasks)} issues ===\n")

    for task in release_tasks:
        issue_number = task["number"]
        print(f"\n{'='*60}")
        print(f"Issue #{issue_number}: {task['title']}")
        print(f"{'='*60}")

        if is_issue_done(issue_number):
            print(f"✓ Issue #{issue_number} already done, skipping.")
            continue

        process_issue(issue_number, release_number)

    print(f"\n=== Release {release_number} complete ===")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=str, required=True,
                        help="Release label suffix, e.g. 1, 2, or masking")
    args = parser.parse_args()
    run_release(args.release)


if __name__ == "__main__":
    main()
