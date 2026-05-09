"""Coder agent: takes a GitHub Issue and writes code, then opens a PR."""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from framework.config import CLAUDE_BIN, PROJECT_ROOT, PROMPTS_DIR, EXTENSION_DIR
from framework.github import create_pr, get_issue

ALLOWED_COMMANDS = {"git status", "git diff", "ls", "find"}


def run_tool(name: str, args: dict) -> str:
    if name == "write_file":
        path = PROJECT_ROOT / args["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"])
        return f"Wrote {args['path']}"

    if name == "read_file":
        path = PROJECT_ROOT / args["path"]
        if not path.exists():
            return f"File not found: {args['path']}"
        return path.read_text()

    if name == "list_files":
        directory = PROJECT_ROOT / args["dir"]
        if not directory.exists():
            return f"Directory not found: {args['dir']}"
        files = [str(p.relative_to(PROJECT_ROOT)) for p in directory.rglob("*") if p.is_file()]
        return "\n".join(files) if files else "(empty)"

    if name == "run_command":
        cmd = args["cmd"]
        if not any(cmd.startswith(allowed) for allowed in ALLOWED_COMMANDS):
            return f"Command not allowed: {cmd}"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=PROJECT_ROOT)
        return result.stdout + result.stderr

    return f"Unknown tool: {name}"


def build_tools_schema() -> list[dict]:
    return [
        {
            "name": "write_file",
            "description": "Write content to a file (path relative to project root)",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                    "content": {"type": "string", "description": "File content"},
                },
                "required": ["path", "content"],
            },
        },
        {
            "name": "read_file",
            "description": "Read a file (path relative to project root)",
            "input_schema": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
        {
            "name": "list_files",
            "description": "List all files in a directory",
            "input_schema": {
                "type": "object",
                "properties": {"dir": {"type": "string"}},
                "required": ["dir"],
            },
        },
        {
            "name": "run_command",
            "description": "Run a whitelisted shell command (git status, git diff, ls, find)",
            "input_schema": {
                "type": "object",
                "properties": {"cmd": {"type": "string"}},
                "required": ["cmd"],
            },
        },
    ]


def call_claude_with_tools(issue: dict, system: str) -> None:
    """Run a tool-use loop with Claude Code CLI using --tool definitions."""
    tools_json = json.dumps(build_tools_schema())
    task = (
        f"Implement the following GitHub Issue for the PromptSentinel Chrome extension.\n\n"
        f"## Issue #{issue['number']}: {issue['title']}\n\n"
        f"{issue['body']}\n\n"
        f"Available tools are described in the tool definitions. "
        f"Start by listing extension/ to see what exists."
    )

    # Claude Code CLI doesn't have a native --tool flag for custom tools yet,
    # so we use a prompt-based tool loop: embed the tool spec in the system prompt
    # and parse Claude's structured tool calls from its response.
    # This is the Claude Code SDK subprocess pattern.
    extended_system = (
        system + "\n\n"
        "## Tool call syntax\n"
        "To call a tool, output a JSON block on its own line:\n"
        '{"tool": "<name>", "args": {<args>}}\n\n'
        "Wait for the tool result before calling the next tool.\n"
        "Tools available: write_file, read_file, list_files, run_command\n"
        f"Tool schemas: {tools_json}"
    )

    messages = [{"role": "user", "content": task}]
    max_iterations = 30

    for i in range(max_iterations):
        prompt_payload = json.dumps({"system": extended_system, "messages": messages})

        result = subprocess.run(
            [CLAUDE_BIN, "--print", "--output-format", "json",
             "--system-prompt", extended_system,
             "\n".join(m["content"] for m in messages if m["role"] == "user")],
            capture_output=True, text=True, cwd=PROJECT_ROOT
        )

        if result.returncode != 0:
            print(f"Claude error: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        data = json.loads(result.stdout)
        response_text = data.get("result", data.get("content", ""))

        print(f"\n[Claude turn {i+1}]")
        print(response_text[:300] + ("..." if len(response_text) > 300 else ""))

        # Check for DONE signal
        if response_text.strip().endswith("DONE"):
            print("\nClaude signalled completion.")
            break

        # Parse tool calls from response
        tool_calls = []
        for line in response_text.splitlines():
            line = line.strip()
            if line.startswith('{"tool":'):
                try:
                    tool_calls.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

        if not tool_calls:
            # No more tool calls and no DONE – treat as complete
            print("\nNo tool calls found, assuming complete.")
            break

        # Execute tools and build next user message with results
        results_text = ""
        for tc in tool_calls:
            tool_result = run_tool(tc["tool"], tc.get("args", {}))
            results_text += f"\nTool `{tc['tool']}` result:\n{tool_result}\n"
            print(f"  [tool] {tc['tool']}({list(tc.get('args', {}).keys())}) → {str(tool_result)[:80]}")

        messages.append({"role": "assistant", "content": response_text})
        messages.append({"role": "user", "content": results_text})
    else:
        print("Warning: max iterations reached", file=sys.stderr)


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
    parser.add_argument("--issue", type=int, required=True, help="GitHub Issue number")
    args = parser.parse_args()

    issue = get_issue(args.issue)
    print(f"Working on issue #{issue['number']}: {issue['title']}")

    branch = f"feature/issue-{issue['number']}-{slugify(issue['title'])}"
    git(["checkout", "main"])
    git(["pull", "origin", "main", "--rebase"])
    git(["checkout", "-b", branch])
    print(f"Created branch: {branch}")

    system = (PROMPTS_DIR / "coder.txt").read_text()
    EXTENSION_DIR.mkdir(exist_ok=True)

    call_claude_with_tools(issue, system)

    # Commit and push
    git(["add", "extension/"])
    status = git(["status", "--porcelain"])
    if not status:
        print("No changes to commit.")
        sys.exit(0)

    git(["commit", "-m", f"feat: {issue['title']} (closes #{issue['number']})"])
    git(["push", "-u", "origin", branch])

    pr_body = (
        f"Closes #{issue['number']}\n\n"
        f"## Changes\n"
        f"Implements: {issue['title']}\n\n"
        f"## Original Issue\n"
        f"{issue['body']}"
    )
    pr_number = create_pr(title=issue["title"], body=pr_body)
    print(f"\nOpened PR #{pr_number}: https://github.com/noloss/promptsentinel/pull/{pr_number}")


if __name__ == "__main__":
    main()
