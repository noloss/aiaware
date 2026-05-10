"""Planner agent: reads prd.md and creates GitHub Issues."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from framework.config import CLAUDE_BIN, PROJECT_ROOT, PROMPTS_DIR
from framework.github import create_issue, ensure_labels, ensure_milestone


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
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--prd", type=str, default=None, help="Path to PRD file (default: prd.md in project root)")
    args = parser.parse_args()

    prd_path = Path(args.prd) if args.prd else PROJECT_ROOT / "prd.md"
    if not prd_path.exists():
        print(f"{prd_path} not found", file=sys.stderr)
        sys.exit(1)

    prd = prd_path.read_text()
    system = (PROMPTS_DIR / "planner.txt").read_text()

    print("Sending PRD to Claude...")
    raw = call_claude(prd, system)

    # Strip markdown fences if Claude added them despite instructions
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        issues = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Failed to parse Claude response as JSON: {e}", file=sys.stderr)
        print("Raw response:", raw[:500], file=sys.stderr)
        sys.exit(1)

    print(f"Claude generated {len(issues)} issues. Creating on GitHub...")

    all_labels = set()
    for issue in issues:
        all_labels.update(issue.get("labels", []))
    ensure_labels(list(all_labels))

    milestone_cache: dict[str, int] = {}
    created = []

    for issue in issues:
        ms_title = issue["milestone"]
        if ms_title not in milestone_cache:
            ensure_milestone(ms_title)
            milestone_cache[ms_title] = True

        criteria_lines = []
        for ac in issue.get("acceptance_criteria", []):
            criteria_lines.append(
                f"**Given** {ac['given']}  \n"
                f"**When** {ac['when']}  \n"
                f"**Then** {ac['then']}"
            )
        criteria_md = "\n\n".join(criteria_lines)

        body = (
            f"## User Story\n{issue['user_story']}\n\n"
            f"## Acceptance Criteria\n{criteria_md}"
        )

        number = create_issue(
            title=issue["title"],
            body=body,
            labels=issue.get("labels", ["ready"]),
            milestone_title=ms_title,
        )
        print(f"  Created issue #{number}: {issue['title']}")
        created.append({"number": number, **issue})

    tasks_path = PROJECT_ROOT / "tasks.json"
    tasks_path.write_text(json.dumps(created, indent=2, ensure_ascii=False))
    print(f"\nDone. {len(created)} issues created. Saved to tasks.json.")
    print(f"View at: https://github.com/noloss/aiaware/issues")


if __name__ == "__main__":
    main()
