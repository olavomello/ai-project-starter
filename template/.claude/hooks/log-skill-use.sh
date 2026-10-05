#!/bin/bash
# PostToolUse hook (Skill) — records that a skill was used, so "last usage"
# in `scripts/skills.mjs list` and the ai-dash viewer is real instead of a
# hand-edited date. Writes to the git-ignored .agents/log/usage.jsonl only
# (names and times, never prompts). Best-effort: it can never fail a tool call.

INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // .tool_input.name // empty' 2>/dev/null)
if [[ -n "$NAME" && "$NAME" =~ ^[a-z0-9:_-]+$ ]]; then
  node "${CLAUDE_PROJECT_DIR:-.}/scripts/skills.mjs" use "${NAME##*:}" --dir "${CLAUDE_PROJECT_DIR:-.}" >/dev/null 2>&1
fi
exit 0
