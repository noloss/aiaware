"""Orchestrator: run the full coder → reviewer loop for a release."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from framework.coder import run_issue
from framework.github import find_open_pr_for_issue
from framework.reviewer import review_pr

MAX_RETRIES = 3


def run_release(release_number: int) -> None:
    tasks_path = Path("tasks.json")
    if not tasks_path.exists():
        print("tasks.json not found – run planner first.", file=sys.stderr)
        sys.exit(1)

    tasks = json.loads(tasks_path.read_text())
    release_tasks = [t for t in tasks if t["release"] == release_number]

    if not release_tasks:
        print(f"No tasks found for release {release_number}.", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== Release {release_number}: {len(release_tasks)} issues ===\n")

    for task in release_tasks:
        issue_number = task["number"]
        print(f"\n{'='*60}")
        print(f"Issue #{issue_number}: {task['title']}")
        print(f"{'='*60}")

        feedback = None

        # Resume from existing open PR if one already exists
        pr_number = find_open_pr_for_issue(issue_number)
        if pr_number:
            print(f"Found existing PR #{pr_number}, resuming reviewer loop.")

        for attempt in range(1, MAX_RETRIES + 1):
            print(f"\n--- Attempt {attempt}/{MAX_RETRIES} ---")

            if not pr_number:
                pr_number = run_issue(issue_number, feedback=feedback)
            if not pr_number:
                print(f"Coder produced no PR for issue #{issue_number}, skipping.")
                break

            verdict, comment = review_pr(pr_number)

            if verdict == "LGTM":
                print(f"\n✓ Issue #{issue_number} done (PR #{pr_number} merged).")
                pr_number = None
                break

            if attempt < MAX_RETRIES:
                print(f"\nRetrying with reviewer feedback...")
                feedback = comment
                pr_number = None  # coder will push new commit and we re-fetch PR
            else:
                print(
                    f"\n✗ Issue #{issue_number} still needs work after {MAX_RETRIES} attempts. "
                    f"Review PR #{pr_number} manually.",
                    file=sys.stderr
                )

    print(f"\n=== Release {release_number} complete ===")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=int, required=True,
                        help="Release number to run (1–6)")
    args = parser.parse_args()
    run_release(args.release)


if __name__ == "__main__":
    main()
