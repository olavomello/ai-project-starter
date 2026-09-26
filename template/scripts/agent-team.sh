#!/usr/bin/env bash
# Agent team helper. See AGENT_TEAM.md.
# Usage:
#   agent-team.sh list
#   agent-team.sh new <nnn-area-role> "<description>" "<glob,glob>"
#   agent-team.sh claim <name> [--as <holder>]
#   agent-team.sh release <name>
#   agent-team.sh sync [<name>]
#   agent-team.sh check
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
DIR=docs/agents; LOCKS=.agents/locks; STATE=.agents/state
STALE_MIN=60
mkdir -p "$DIR" "$LOCKS" "$STATE"

field() { sed -n "s/^$2[[:space:]]*:[[:space:]]*//p" "$1" | head -n1; }
globs_of() { field "$DIR/$1.md" "Owns" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$'; }
valid_name() { [[ "$1" =~ ^[a-z0-9]{3}-[a-z0-9]+-[a-z0-9]+$ ]]; }

overlap() { # two globs -> 0 if they can match the same path
  local a="${1%/}" b="${2%/}"
  a="${a%%\**}"; b="${b%%\**}"
  [[ "$a" == "$b"* || "$b" == "$a"* ]]
}

cmd_list() {
  shopt -s nullglob
  local any=0
  for f in "$DIR"/*.md; do
    [[ "$(basename "$f")" == _* ]] && continue
    any=1
    local n s o held=""
    n="$(field "$f" Name)"; s="$(field "$f" Status)"; o="$(field "$f" Owns)"
    [[ -d "$LOCKS/$(basename "$f" .md)" ]] && held=" [CLAIMED]"
    printf '%-24s %-4s %s%s\n' "${n:-$(basename "$f" .md)}" "${s:-?}" "${o:-—}" "$held"
  done
  (( any )) || echo "(no agents defined)"
}

cmd_new() {
  local name="${1:?name}" desc="${2:?description}" owns="${3:?owns globs}"
  valid_name "$name" || { echo "invalid name '$name' — expected <3 letters>-<area>-<role>, lowercase" >&2; exit 1; }
  [[ -f "$DIR/$name.md" ]] && { echo "$DIR/$name.md already exists" >&2; exit 1; }
  # warn about overlapping ownership with existing agents
  shopt -s nullglob
  for f in "$DIR"/*.md; do
    [[ "$(basename "$f")" == _* ]] && continue
    local other; other="$(basename "$f" .md)"
    while read -r g; do
      while read -r h; do
        [[ -z "$g" || -z "$h" ]] && continue
        overlap "$g" "$h" && echo "warning: '$g' overlaps '$h' owned by $other — use a worktree or narrow the scope" >&2
      done < <(echo "$owns" | tr ',' '\n' | sed 's/^ *//; s/ *$//')
    done < <(globs_of "$other")
  done
  sed -e "s|<nnn-area-role>|$name|" \
      -e "s|<one line — what this agent does>|$desc|" \
      -e "s|<comma-separated globs this agent may write>|$owns|" \
      -e "s|<parent agent, or Main>|${AGENT_PARENT:-Main}|" \
      "$DIR/_TEMPLATE.md" > "$DIR/$name.md"
  echo "created $DIR/$name.md — fill in SCOPE AND RULES before dispatching"
}

cmd_claim() {
  local name="${1:?name}"; shift || true
  local holder="${AGENT_HOLDER:-$name}"
  [[ "${1:-}" == "--as" ]] && holder="${2:?holder}"
  [[ -f "$DIR/$name.md" ]] || { echo "unknown agent: $name" >&2; exit 1; }
  [[ "$(field "$DIR/$name.md" Status)" == "ON" ]] || { echo "$name is not ON" >&2; exit 1; }
  # conflict check against live claims
  local mine conflict=0
  mine="$(globs_of "$name")"
  shopt -s nullglob
  for d in "$LOCKS"/*/; do
    local other; other="$(basename "$d")"
    [[ "$other" == "$name" ]] && continue
    while read -r g; do while read -r h; do
      [[ -z "$g" || -z "$h" ]] && continue
      overlap "$g" "$h" && { echo "CONFLICT: '$g' overlaps '$h' held by $other since $(cat "$d/since" 2>/dev/null)" >&2; conflict=1; }
    done < <(cat "$d/globs" 2>/dev/null); done < <(echo "$mine")
  done
  (( conflict )) && { echo "claim refused — wait, narrow the scope, or use a worktree" >&2; exit 1; }
  mkdir "$LOCKS/$name" 2>/dev/null || { echo "already claimed by $(cat "$LOCKS/$name/holder" 2>/dev/null)" >&2; exit 1; }
  echo "$holder" > "$LOCKS/$name/holder"
  date -u +%FT%TZ > "$LOCKS/$name/since"
  echo "$mine" > "$LOCKS/$name/globs"
  git rev-parse HEAD 2>/dev/null > "$STATE/$name.head" || true
  echo "claimed $name: $(echo "$mine" | tr '\n' ' ')"
}

cmd_release() {
  local name="${1:?name}"
  [[ -d "$LOCKS/$name" ]] || { echo "$name holds no claim"; exit 0; }
  rm -rf "${LOCKS:?}/$name"; echo "released $name"
}

cmd_sync() {
  local name="${1:-}"
  git fetch --quiet 2>/dev/null || echo "(fetch skipped — no remote or offline)"
  local base=""
  [[ -n "$name" && -f "$STATE/$name.head" ]] && base="$(cat "$STATE/$name.head")"
  if [[ -n "$base" ]] && git cat-file -e "$base" 2>/dev/null; then
    echo "--- changed since $name last checkpoint ($base)"
    git diff --stat "$base"..HEAD || true
  fi
  echo "--- working tree"
  git status --short
  echo "--- other live claims"
  shopt -s nullglob; local any=0
  for d in "$LOCKS"/*/; do
    [[ "$(basename "$d")" == "$name" ]] && continue
    any=1; echo "$(basename "$d") since $(cat "$d/since" 2>/dev/null): $(tr '\n' ' ' < "$d/globs" 2>/dev/null)"
  done
  (( any )) || echo "(none)"
  echo "Re-read any file before editing it."
}

cmd_check() {
  local failed=0
  shopt -s nullglob
  for f in "$DIR"/*.md; do
    [[ "$(basename "$f")" == _* ]] && continue
    local b; b="$(basename "$f" .md)"
    valid_name "$b" || { echo "FAIL: $f — filename is not <3 letters>-<area>-<role>" >&2; failed=1; }
    [[ "$(field "$f" Name)" == "$b" ]] || { echo "FAIL: $f — Name does not match filename" >&2; failed=1; }
    case "$(field "$f" Status)" in ON|OFF) ;; *) echo "FAIL: $f — Status must be ON or OFF" >&2; failed=1;; esac
    [[ -n "$(field "$f" Description)" ]] || { echo "FAIL: $f — empty Description" >&2; failed=1; }
    grep -q '^## SCOPE AND RULES' "$f" || { echo "FAIL: $f — missing SCOPE AND RULES" >&2; failed=1; }
  done
  local n; n=$(ls -d "$LOCKS"/*/ 2>/dev/null | wc -l)
  (( n > 4 )) && { echo "FAIL: $n concurrent claims, limit is 4" >&2; failed=1; }
  for d in "$LOCKS"/*/; do
    local since; since="$(cat "$d/since" 2>/dev/null)" || continue
    local age=$(( ($(date -u +%s) - $(date -u -d "$since" +%s 2>/dev/null || echo 0)) / 60 ))
    (( age > STALE_MIN )) && echo "warning: claim by $(basename "$d") is ${age}m old — may be stale" >&2
  done
  (( failed )) && { echo "agent-team check FAILED" >&2; exit 1; }
  echo "ok:   agent team"
}

case "${1:-}" in
  list) cmd_list;;
  new) shift; cmd_new "$@";;
  claim) shift; cmd_claim "$@";;
  release) shift; cmd_release "$@";;
  sync) shift; cmd_sync "${1:-}";;
  check) cmd_check;;
  *) sed -n '2,10p' "$0"; exit 2;;
esac
