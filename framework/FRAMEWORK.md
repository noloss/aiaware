# Prompt Masker — Agent Framework

A three-agent CI pipeline that converts a Product Requirements Document (PRD) into merged, tested code without a human writing any code.

---

## High-Level Overview

```
PRD file
   │
   ▼
planner.py  ──►  GitHub Issues  (tagged with release-N label)
                      │
                      ▼
             run_release.py  (orchestrator)
                      │
          ┌───────────┼───────────────────────────────┐
          ▼           ▼                               ▼
      coder.py    node --test              reviewer.py
      (writes     (run after every         (approves or
       code,       coder attempt)           requests changes)
       opens PR)
          │
          └──► on timeout: splitter breaks issue into sub-issues
```

Each agent is a Python script that calls the `claude` CLI binary as a subprocess. Agents share no memory — they communicate only through GitHub (issues, PRs, diffs) and the local filesystem.

---

## Directory Structure

```
framework/
├── config.py           ← Environment and path constants
├── github.py           ← gh CLI wrapper (all GitHub operations)
├── planner.py          ← PRD → GitHub Issues
├── coder.py            ← Issue → branch + code + PR
├── reviewer.py         ← PR diff → approve/reject
├── run_release.py      ← Orchestrator loop
└── prompts/
    ├── planner.txt     ← System prompt for planner
    ├── coder.txt       ← System prompt for coder
    ├── reviewer.txt    ← System prompt for reviewer
    └── splitter.txt    ← System prompt for issue splitter
```

---

## Running the Pipeline

```bash
# Step 1 — create GitHub issues from a PRD
source venv/bin/activate
python framework/planner.py --prd prd_myfeature.md

# Step 2 — run the full coder→test→reviewer loop for all issues in a release
python framework/run_release.py --release 1

# Run individual agents manually
python framework/coder.py --issue 42
python framework/reviewer.py --pr 99
```

---

## Agent 1: Planner (`planner.py`)

**Purpose:** Reads a PRD and creates GitHub Issues.

**How it works:**

1. Reads the PRD file (defaults to `prd.md` at the project root; override with `--prd`).
2. Calls `claude --print --output-format json` with `prompts/planner.txt` as the system prompt.
3. Parses the JSON result. If Claude wraps the array in a code fence despite instructions, a fallback strips the fences before parsing.
4. Calls `ensure_labels()` and `ensure_milestone()` for all labels/milestones in the response.
5. Creates each issue via `gh issue create`, formatting acceptance criteria as Given/When/Then blocks in the issue body.
6. Writes a local `tasks.json` as a convenience dump. **Note:** the orchestrator never reads this file — it always queries GitHub directly.

**Issue JSON schema:**
```json
{
  "release": 1,
  "milestone": "Release 1",
  "title": "[R1] Short imperative title",
  "labels": ["release-1", "ready"],
  "user_story": "As a user, I want...",
  "acceptance_criteria": [
    { "given": "...", "when": "...", "then": "..." }
  ]
}
```

**Known issues:**
- Line 106 prints a stale URL (`noloss/aiaware/issues`) — old project name, not used for anything functional.

---

## Agent 2: Coder (`coder.py`)

**Purpose:** Implements one GitHub issue on a feature branch and opens a PR.

**Entry point:** `run_issue(issue_number, feedback=None)` → returns PR number or `None`

**How it works:**

1. Fetches the issue body from GitHub.
2. Determines branch state:
   - New issue: checks out `main`, pulls, creates `feature/issue-{N}-{slug}`.
   - Retry with feedback (reviewer rejected): checks out existing branch, continues from where it left off.
   - Interrupted run with no PR: resets existing branch to `origin/main` for a clean start.
3. Calls `claude --print --dangerously-skip-permissions` as a subprocess. This flag is required because Claude needs to read, write, and edit files without interactive approval prompts.
4. Two threads run while Claude works:
   - **Reader thread**: streams Claude's stdout, printing each line with a `[coder]` prefix.
   - **Heartbeat thread**: prints `[coder] Ns — last activity...` to stderr every 30 seconds.
5. **Timeout: 600 seconds (10 minutes).** On timeout, kills the subprocess and returns `None`, which triggers the issue splitter in the orchestrator.
6. Stages only `extension/` with `git add extension/` and commits. Test files written by Claude to `tests/` are left as untracked files on disk — they are **not committed** as part of the PR. They persist on the local filesystem and are found by `node --test` during the pipeline run.
7. Pushes the branch. On the first attempt, opens a PR via `gh pr create`. On retries, pushes to the existing branch (PR already exists).

**Commit messages:**
- First attempt: `feat: {issue title} (closes #{N})`
- Retry: `fix: address review feedback (#{N})`

**Feedback parameter:** When retrying after a failed test run or reviewer rejection, the orchestrator passes the test output or reviewer comment as `feedback`. This is appended to the Claude prompt, instructing it to read existing files and fix only what was flagged.

---

## Agent 3: Reviewer (`reviewer.py`)

**Purpose:** Reviews a PR diff against the issue's acceptance criteria and either approves or rejects.

**Entry point:** `review_pr(pr_number)` → returns `(verdict, comment)`

**How it works:**

1. Fetches PR metadata (title, body, branch) and the full diff via `gh pr diff`.
2. Truncates the diff to 20,000 characters if it exceeds that limit.
3. Calls `claude --print --output-format json` with `prompts/reviewer.txt` as the system prompt.
4. Parses the JSON verdict. If Claude returns prose instead of JSON (a recurring failure mode), the function returns `("CHANGES_REQUESTED", error message)`, which causes the orchestrator to retry the coder.
5. On **LGTM**: posts a `✅ LGTM` comment and merges the PR (squash, deletes branch).
6. On **CHANGES_REQUESTED**: posts a `🔴 CHANGES REQUESTED` comment, adds the `needs-work` label, removes `needs-review`.

**Note on GitHub's own-PR restriction:** GitHub does not allow approving or formally requesting changes on PRs opened by the same account. Both `approve_pr()` and `request_changes()` in `github.py` work around this by posting comments and editing labels instead of using the review API.

**Known issues:**
- `reviewer.txt` refers to "AI Aware extension" — the old project name. Functionally harmless but inconsistent.

---

## Orchestrator (`run_release.py`)

**Purpose:** Drives the full coder→test→reviewer loop for every issue in a release.

**How it works:**

1. Fetches all GitHub Issues labelled `release-{N}` (both open and closed, sorted by issue number).
2. Skips any issue where `is_issue_done()` returns true (i.e., the GitHub issue is in CLOSED state).
3. For each remaining issue, runs `process_issue()`:

```
for attempt in 1..3:

    if no open PR exists yet:
        pr_number = coder.run_issue(issue_number, feedback)

    if pr_number is None:  ← coder timed out
        split_issue() → creates 2–4 sub-issues on GitHub
        process each sub-issue recursively
        return

    run: node --test

    if tests fail and attempts remain:
        feedback = test output (last 2000 chars)
        pr_number = None   ← force a new commit/PR next attempt
        continue

    if tests fail after 3 attempts:
        print error — manual fix needed
        return

    verdict, comment = reviewer.review_pr(pr_number)

    if LGTM → return  ✓ done

    if CHANGES_REQUESTED and attempts remain:
        feedback = reviewer comment
        pr_number = None
        continue

    if CHANGES_REQUESTED after 3 attempts:
        print error — manual fix needed
```

**Issue splitter** (`split_issue()` in run_release.py): Calls Claude with `prompts/splitter.txt`, which decomposes the oversized issue into 2–4 smaller ones. The original issue is closed with a comment linking the sub-issues. Each sub-issue is then processed by the same `process_issue()` loop.

**Resumability:** The orchestrator is safe to re-run. `is_issue_done()` skips closed issues, and `find_open_pr_for_issue()` resumes from an existing open PR rather than creating a duplicate.

---

## GitHub Integration (`github.py`)

A thin wrapper around the `gh` CLI binary. All GitHub operations go through here.

| Function | What it does |
|---|---|
| `_run(args)` | Runs `gh <args>`, raises on non-zero exit |
| `ensure_labels(labels)` | Creates any labels that don't exist (with preset colors) |
| `ensure_milestone(title)` | Creates milestone if absent |
| `create_issue(title, body, labels, milestone_title)` | Creates issue, returns number |
| `get_issue(number)` | Returns `{number, title, body, labels}` |
| `find_open_pr_for_issue(number)` | Finds open PR with `"Closes #{N}"` in its body |
| `is_issue_done(number)` | Returns true if the GitHub issue is in `CLOSED` state |
| `create_pr(title, body)` | Opens PR against main, labels it `needs-review`, returns number |
| `get_pr_diff(pr_number)` | Returns raw unified diff text |
| `approve_pr(pr_number, comment)` | Posts `✅ LGTM` comment (can't use review API on own PRs) |
| `request_changes(pr_number, comment)` | Posts `🔴 CHANGES REQUESTED` comment, swaps labels |
| `merge_pr(pr_number)` | Squash merges, deletes branch |

**`is_issue_done()` detail:** Checks if the GitHub issue itself is CLOSED. GitHub automatically closes an issue when a PR with `Closes #N` in the body is merged.

**Known issues:**
- `approve_pr()` is defined twice in github.py (lines 95 and 108). The second definition silently overrides the first. The first (which calls `gh pr review --approve`) is dead code.

---

## Configuration (`config.py`)

```python
GITHUB_REPO  = os.getenv("GITHUB_REPO", "noloss/promptmasker")  # override via .env
GH_BIN       = os.path.expanduser("~/.local/bin/gh")
CLAUDE_BIN   = "claude"          # must be on PATH
PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_DIR = PROJECT_ROOT / "extension"
PROMPTS_DIR  = Path(__file__).parent / "prompts"
```

`GITHUB_REPO` can be overridden via a `.env` file at the project root (loaded by `python-dotenv`).

---

## System Prompts (`prompts/`)

### `planner.txt`

Instructs Claude to act as a senior PM/architect. Starts with: *"Your entire response must be a single raw JSON array."* This leading instruction is critical — without it Claude tends to return prose with JSON embedded, breaking the parser.

Rules enforced in the prompt:
- 3–6 issues per release, each completable in 1–3 hours
- Titles max 60 chars, prefixed `[R1]`, `[R2]`, etc.
- Every issue must include a final acceptance criterion asserting `node --test` passes with exit code 0
- Labels must include the release label and `ready`

### `coder.txt`

Instructs Claude to act as a Chrome Extension MV3 developer. Key rules:
- Always list and read existing files before modifying them
- Only write files to `extension/`
- Write tests to `tests/` using Node.js built-in test runner (`node:test`, `node:assert`) — no npm, no Jest
- Never add host permissions or make network requests
- Do not break existing functionality

### `reviewer.txt`

Instructs Claude to act as a security-focused reviewer. Returns `{"verdict": "LGTM"|"CHANGES_REQUESTED", "comment": "..."}` and nothing else.

Review checklist:
- All Given/When/Then acceptance criteria satisfied
- No remote data transmission (`fetch`, `XMLHttpRequest`, `WebSocket` to external domains)
- No `eval()` or `innerHTML` with unsanitized input
- No new permissions in `manifest.json`
- All UI text in English (Finnish or other languages → required change)
- Valid Manifest V3

### `splitter.txt`

Instructs Claude to decompose an oversized issue into 2–4 smaller sub-issues. Returns a JSON array of issue objects with the same schema as the planner output. Sub-issues must be ordered so earlier ones don't depend on later ones, and their union must cover everything in the original issue.

---

## Test Suite (`tests/`)

Tests are written by the coder agent using the Node.js built-in test runner (no external dependencies required):

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
```

Run with: `node --test` from the repo root.

The orchestrator runs the full test suite after every coder attempt. All tests must pass before the reviewer sees the PR.

**Important:** The coder agent stages only `extension/` when committing (`git add extension/`). Test files written to `tests/` are not committed as part of the PR — they exist as untracked files on the local filesystem during the pipeline run. Tests that should be permanent need to be committed separately.

---

## Known Issues and Rough Edges

| Location | Issue |
|---|---|
| `planner.py:106` | Prints stale URL `noloss/aiaware/issues` (old project name) |
| `reviewer.txt:1` | Refers to "AI Aware extension" (old project name) |
| `github.py:95,108` | `approve_pr()` defined twice; first definition (which calls `gh pr review --approve`) is dead code |
| `coder.py:120` | Only stages `extension/` — test files in `tests/` are never committed by the pipeline |
| `planner.py:103` | Writes `tasks.json` locally but this file is never read by the orchestrator |
