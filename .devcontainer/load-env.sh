#!/usr/bin/env bash
# Creates .devcontainer/.env from .env.example (if it doesn't exist yet) and makes
# every new terminal load it, so agent CLIs (Claude Code, Copilot CLI) pick up
# their token without logging in each session. The file is read when a terminal
# starts, so a token entered later works in the next terminal you open.
set -euo pipefail

# Interactive Claude Code ignores CLAUDE_CODE_OAUTH_TOKEN and asks to log in until its
# first-run onboarding is marked as done (anthropics/claude-code#46259).
node -e '
  const fs = require("fs"), f = require("os").homedir() + "/.claude.json";
  let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  if (c.hasCompletedOnboarding !== true) {
    c.hasCompletedOnboarding = true;
    fs.writeFileSync(f, JSON.stringify(c, null, 2));
  }
'

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$dir/.env"
[ -f "$env_file" ] || cp "$dir/.env.example" "$env_file"

line="[ -f \"$env_file\" ] && { set -a; . \"$env_file\"; set +a; }"
for rc in ~/.bashrc ~/.zshrc; do
  touch "$rc"
  grep -qxF "$line" "$rc" || printf '\n# Load agent tokens (see .devcontainer/.env)\n%s\n' "$line" >> "$rc"
done
