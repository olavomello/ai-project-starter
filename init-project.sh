#!/usr/bin/env bash
# Create a new project from ai-project-starter.
# Usage: init-project.sh <target-dir> [git-ref]
set -euo pipefail
TARGET="${1:?usage: init-project.sh <target-dir> [git-ref]}"
REF="${2:-main}"
REPO="https://github.com/olavomello/ai-project-starter.git"
[[ -e "$TARGET" && -n "$(ls -A "$TARGET" 2>/dev/null)" ]] && { echo "target '$TARGET' exists and is not empty" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$REF" "$REPO" "$TMP/starter"
STARTER_VERSION="$(tr -d '[:space:]' < "$TMP/starter/VERSION")"
mkdir -p "$TARGET"
cp -R "$TMP/starter/template/." "$TARGET/"
cd "$TARGET"
chmod +x .claude/skills/*/scripts/*.sh
chmod +x .claude/hooks/*.sh 2>/dev/null || true
git init --quiet
git branch -M main 2>/dev/null || true
git add -A
git commit --quiet -m "chore: initialize project from ai-project-starter v$STARTER_VERSION"
bash .claude/skills/semver-release/scripts/check-version.sh
echo "Project created at $TARGET (starter v$STARTER_VERSION). Next: open Claude Code there and run the starter agent"
echo "  (read docs/agents/sys-init-starter.md and follow it end to end) — it fills in AGENTS.md section 0 and README.md, sets the agent policy and creates the agent team."
echo "Optional: node scripts/mod.mjs enable   (turns on the in-session status mod for Claude Code)"
