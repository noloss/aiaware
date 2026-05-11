import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

GITHUB_REPO = os.getenv("GITHUB_REPO", "noloss/promptmasker")
GH_BIN = os.path.expanduser("~/.local/bin/gh")
CLAUDE_BIN = "claude"

PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_DIR = PROJECT_ROOT / "extension"
PROMPTS_DIR = Path(__file__).parent / "prompts"
