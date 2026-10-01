#!/bin/bash
# PreToolUse hook (Edit|Write) — enforces AGENTS.md section 1:
# "Agents never bump VERSION or create tags on their own — they report a
# version-impact line and you decide." This was convention-only; this hook
# makes it a hard rule instead of something an agent could forget or skip.
#
# - VERSION: never editable through the Edit/Write tools. The only sanctioned
#   path is `.claude/skills/semver-release/scripts/bump.sh`, which writes the
#   file directly via the shell (Bash tool), not through Edit/Write — so this
#   hook doesn't block the sanctioned release flow, only the shortcut.
# - CHANGELOG.md: normal edits (adding to "## [Unreleased]") are allowed.
#   Introducing a brand-new version heading ("## [x.y.z] - ...") is blocked —
#   that's cutting a release, which goes through the same sanctioned flow.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
FILE_PATH="${FILE_PATH//\\//}"

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

BASENAME="$(basename "$FILE_PATH")"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

if [[ "$BASENAME" == "VERSION" ]]; then
  echo "Blocked: VERSION is never hand-edited. Report a version-impact line and let the Administrator run \`bash .claude/skills/semver-release/scripts/bump.sh\` (or the equivalent release step)." >&2
  exit 2
fi

if [[ "$BASENAME" == "CHANGELOG.md" ]]; then
  CANDIDATE=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty')

  # Semver release headings, e.g. "## [1.2.0] - 2026-09-30". "## [Unreleased]" is exempt.
  NEW_HEADINGS=$(echo "$CANDIDATE" | grep -Eo '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' || true)

  if [[ -n "$NEW_HEADINGS" ]]; then
    EXISTING="$PROJECT_DIR/$FILE_PATH"
    [[ -f "$EXISTING" ]] || EXISTING="$FILE_PATH"
    while IFS= read -r heading; do
      [[ -z "$heading" ]] && continue
      if ! grep -qF "$heading" "$EXISTING" 2>/dev/null; then
        echo "Blocked: this introduces a new release heading ($heading) in CHANGELOG.md. Cutting a release is the Administrator's call — use the release flow instead of a direct edit. Entries under \"## [Unreleased]\" are fine." >&2
        exit 2
      fi
    done <<< "$NEW_HEADINGS"
  fi
fi

exit 0
