#!/usr/bin/env bash
# Agent team helper. See AGENT_TEAM.md.
# Usage:
#   agent-team.sh list
#   agent-team.sh new <nnn-area-role> "<description>" "<glob,glob>"
#   agent-team.sh start <name>            create branch + worktree
#   agent-team.sh sync <name>             fetch and rebase the agent branch onto main
#   agent-team.sh classify [<name>]       mechanical | administrator
#   agent-team.sh finish <name>           rebase, gate, push, open PR
#   agent-team.sh cleanup <name>          remove worktree and local branch
#   agent-team.sh claim <name>            declare intended paths (advisory)
#   agent-team.sh release <name>
#   agent-team.sh check
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
DIR=docs/agents; LOCKS=.agents/locks; STATE=.agents/state; TREES=.agents/worktrees
BASE="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"; BASE="${BASE:-main}"
STALE_MIN=60
mkdir -p "$DIR" "$LOCKS" "$STATE" "$TREES"

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
    local b; b="$(basename "$f" .md)"
    [[ -d "$LOCKS/$b" ]] && held=" [declared]"
    git show-ref --quiet "refs/heads/agent/$b" 2>/dev/null && held="$held [branch]"
    [[ -d "$TREES/$b" ]] && held="$held [worktree]"
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
  (( conflict )) && echo "note: overlapping intent — worktrees keep the work safe, but expect a merge conflict; consider splitting differently" >&2
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

cmd_start() {
  local name="${1:?name}" br
  [[ -f "$DIR/$name.md" ]] || { echo "unknown agent: $name" >&2; exit 1; }
  [[ "$(field "$DIR/$name.md" Status)" == "ON" ]] || { echo "$name is not ON" >&2; exit 1; }
  br="agent/$name"
  [[ -d "$TREES/$name" ]] && { echo "worktree already exists: $TREES/$name"; exit 0; }
  git fetch --quiet 2>/dev/null || true
  local from="$BASE"
  git show-ref --quiet "refs/remotes/origin/$BASE" 2>/dev/null && from="origin/$BASE"
  if git show-ref --quiet "refs/heads/$br"; then
    git worktree add "$TREES/$name" "$br" >/dev/null || exit 1
  else
    git worktree add -b "$br" "$TREES/$name" "$from" >/dev/null || exit 1
  fi
  git rev-parse HEAD > "$STATE/$name.head" 2>/dev/null || true
  echo "worktree: $TREES/$name   branch: $br   from: $from"
  echo "Work only inside that directory."
}

cmd_sync() {
  local name="${1:-}"
  git fetch --quiet 2>/dev/null || echo "(fetch skipped — no remote or offline)"
  if [[ -z "$name" || ! -d "$TREES/$name" ]]; then
    echo "--- working tree"; git status --short
    echo "--- declared intent"
    shopt -s nullglob; local any=0
    for d in "$LOCKS"/*/; do any=1; echo "$(basename "$d") since $(cat "$d/since" 2>/dev/null): $(tr '\n' ' ' < "$d/globs" 2>/dev/null)"; done
    (( any )) || echo "(none)"
    return
  fi
  local onto="$BASE"
  git show-ref --quiet "refs/remotes/origin/$BASE" 2>/dev/null && onto="origin/$BASE"
  echo "--- rebasing agent/$name onto $onto"
  if git -C "$TREES/$name" rebase "$onto"; then
    echo "ok:   rebased"
  else
    echo "REBASE CONFLICT in $TREES/$name — resolve there, then 'git rebase --continue'. Do not force-push over anyone." >&2
    exit 1
  fi
  echo "--- diff vs $onto"
  git -C "$TREES/$name" diff --stat "$onto"...HEAD
  echo "Re-read any file before editing it."
}

changed_files() { # <worktree dir> <base ref>
  git -C "$1" diff --name-only "$2"...HEAD
}

cmd_classify() {
  local name="${1:-}" dir="." onto="$BASE"
  [[ -n "$name" && -d "$TREES/$name" ]] && dir="$TREES/$name"
  git show-ref --quiet "refs/remotes/origin/$BASE" 2>/dev/null && onto="origin/$BASE"
  local files lines verdict=mechanical reason=""
  files="$(changed_files "$dir" "$onto")"
  [[ -z "$files" ]] && { echo "administrator: no changes to classify"; return; }
  lines="$(git -C "$dir" diff --shortstat "$onto"...HEAD | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | grep -oE '^[0-9]+' | paste -sd+ | bc 2>/dev/null)"
  lines="${lines:-0}"
  local sensitive='(^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|deno\.lock|requirements.*\.txt|pyproject\.toml|poetry\.lock|Cargo\.(toml|lock)|Gemfile.*|go\.(mod|sum))$|^\.github/|(^|/)(Dockerfile|docker-compose|Makefile)|(^|/)(infra|deploy|terraform|helm|k8s)/|(^|/)(migrations?|schema)/|(^|/)(auth|security|payment|billing)(/|s/)|^VERSION$|^CHANGELOG\.md$|^AGENTS\.md$|^AGENT_TEAM\.md$|^scripts/(gate|agent-team)\.sh$|^\.claude/|(^|/)\.env'
  local safe='(^docs/|\.md$|^tests?/|(^|/)__tests__/|\.(test|spec)\.[a-z]+$|^\.?prettierrc|\.editorconfig$)'
  while read -r f; do
    [[ -z "$f" ]] && continue
    if echo "$f" | grep -qE "$sensitive"; then verdict=administrator; reason="sensitive path: $f"; break; fi
    if ! echo "$f" | grep -qE "$safe"; then verdict=administrator; reason="production code: $f"; break; fi
  done <<< "$files"
  if [[ "$verdict" == mechanical && "$lines" -ge 400 ]]; then verdict=administrator; reason="$lines changed lines (limit 400)"; fi
  if [[ "$verdict" == mechanical ]]; then echo "mechanical: docs/tests/formatting only, $lines lines"
  else echo "administrator: $reason"; fi
}

cmd_finish() {
  local name="${1:?name}"
  [[ -d "$TREES/$name" ]] || { echo "no worktree for $name — run 'start' first" >&2; exit 1; }
  cmd_sync "$name" >/dev/null || exit 1
  local dir="$TREES/$name"
  if [[ -n "$(git -C "$dir" status --porcelain)" ]]; then
    git -C "$dir" add -A
    git -C "$dir" commit -q -m "${AGENT_COMMIT_MSG:-chore($name): work in progress}" || true
  fi
  echo "--- gate"
  ( cd "$dir" && bash scripts/gate.sh ) || { echo "gate failed — fix the branch, do not weaken the gate" >&2; exit 1; }
  local br="agent/$name" verdict; verdict="$(cmd_classify "$name")"
  if git remote get-url origin >/dev/null 2>&1; then
    git -C "$dir" push -u origin "$br" 2>&1 | tail -2
    if command -v gh >/dev/null 2>&1; then
      ( cd "$dir" && gh pr create --base "$BASE" --head "$br" \
          --title "${AGENT_PR_TITLE:-chore($name): $(field "$DIR/$name.md" Description)}" \
          --body "$(printf 'Agent: %s\n\n## What changed\n%s\n\n## How it was verified\nscripts/gate.sh passed on this branch.\n\n## Open\n%s\n\n## Classification\n%s\n' \
                    "$name" "${AGENT_PR_WHAT:-see commits}" "${AGENT_PR_OPEN:-none}" "$verdict")" ) || echo "(gh pr create failed — open the PR manually)"
    else
      echo "open a PR: $(git remote get-url origin | sed 's#git@github.com:#https://github.com/#; s#\.git$##')/compare/$BASE...$br?expand=1"
    fi
  else
    echo "(no remote — branch $br is ready locally)"
  fi
  echo "classification: $verdict"
  case "$verdict" in
    mechanical*) echo "main_merge: true -> Main may merge. main_merge: false -> waits for the Administrator.";;
    *) echo "waits for the Administrator.";;
  esac
}

cmd_cleanup() {
  local name="${1:?name}"
  [[ -d "$TREES/$name" ]] && git worktree remove "$TREES/$name" --force && echo "removed worktree"
  git worktree prune
  git show-ref --quiet "refs/heads/agent/$name" && git branch -D "agent/$name" >/dev/null && echo "deleted branch agent/$name"
  rm -rf "${LOCKS:?}/$name"
  echo "cleaned $name"
}

case "${1:-}" in
  list) cmd_list;;
  new) shift; cmd_new "$@";;
  claim) shift; cmd_claim "$@";;
  release) shift; cmd_release "$@";;
  start) shift; cmd_start "$@";;
  sync) shift; cmd_sync "${1:-}";;
  classify) shift; cmd_classify "${1:-}";;
  finish) shift; cmd_finish "$@";;
  cleanup) shift; cmd_cleanup "$@";;
  check) cmd_check;;
  *) sed -n '2,14p' "$0"; exit 2;;
esac
