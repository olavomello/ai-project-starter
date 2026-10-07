#!/usr/bin/env bash
# Single verification entrypoint. Usage: scripts/gate.sh [--release]
# Override any step in .agents/gate.conf:  FORMAT=... LINT=... TYPES=... TEST=...
# Set a step to "skip" to disable it. Unset steps are auto-detected from the stack.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
RELEASE=0; [[ "${1:-}" == "--release" ]] && RELEASE=1
FAILED=0
[[ -f .agents/gate.conf ]] && source .agents/gate.conf

has() { command -v "$1" >/dev/null 2>&1; }
npm_script() { [[ -f package.json ]] && node -e "process.exit(require('./package.json').scripts?.['$1']?0:1)" 2>/dev/null; }
deno_task() { [[ -f deno.json || -f deno.jsonc ]] && grep -q "\"$1\"" deno.json deno.jsonc 2>/dev/null; }

detect() { # step name -> command, or empty
  case "$1" in
    format) npm_script format && echo "npm run format" && return
            deno_task fmt && echo "deno task fmt" && return
            [[ -f deno.json ]] && has deno && echo "deno fmt --check" && return
            has ruff && [[ -f pyproject.toml ]] && echo "ruff format --check ." && return;;
    lint)   npm_script lint && echo "npm run lint" && return
            deno_task lint && echo "deno task lint" && return
            [[ -f deno.json ]] && has deno && echo "deno lint" && return
            has ruff && [[ -f pyproject.toml ]] && echo "ruff check ." && return
            [[ -f Cargo.toml ]] && has cargo && echo "cargo clippy -- -D warnings" && return;;
    types)  npm_script typecheck && echo "npm run typecheck" && return
            [[ -f tsconfig.json ]] && has npx && echo "npx --no-install tsc --noEmit" && return
            [[ -f deno.json ]] && has deno && echo "deno check ." && return
            has mypy && [[ -f pyproject.toml ]] && echo "mypy ." && return;;
    test)   npm_script test && echo "npm test" && return
            deno_task test && echo "deno task test" && return
            [[ -f deno.json ]] && has deno && echo "deno test -A" && return
            has pytest && { [[ -f pyproject.toml || -f setup.cfg || -d tests ]]; } && echo "pytest -q" && return
            [[ -f Cargo.toml ]] && has cargo && echo "cargo test" && return;;
  esac
}

run() { # label, configured value, step key
  local label="$1" cmd="$2" key="$3"
  [[ "$cmd" == "skip" ]] && { echo "skip: $label"; return; }
  [[ -z "$cmd" ]] && cmd="$(detect "$key")"
  [[ -z "$cmd" ]] && { echo "skip: $label (not configured)"; return; }
  echo "--- $label: $cmd"
  if eval "$cmd"; then echo "ok:   $label"; else echo "FAIL: $label" >&2; FAILED=1; fi
}

run format "${FORMAT-}" format
run lint   "${LINT-}"   lint
run types  "${TYPES-}"  types
run test   "${TEST-}"   test

if [[ -x scripts/agent-team.sh ]]; then
  echo "--- agent team"
  bash scripts/agent-team.sh check || FAILED=1
fi

if command -v node >/dev/null 2>&1 && [[ -f scripts/skills.mjs && -d .claude/skills ]]; then
  echo "--- skills frontmatter"
  node scripts/skills.mjs check || FAILED=1
fi


GATE=.claude/skills/semver-release/scripts/check-version.sh
if [[ -f $GATE ]]; then
  echo "--- version gate"
  if (( RELEASE )); then bash "$GATE" --release || FAILED=1; else bash "$GATE" || FAILED=1; fi
else
  echo "skip: version gate (script missing)"
fi

automatic_log() {
  # Best-effort execution logging — never allowed to affect FAILED. Runs only
  # when node and a real git repo are present; silently skipped otherwise.
  has node || return 0
  [[ -f scripts/ai-log.mjs ]] || return 0
  local common_dir
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  [[ -n "$common_dir" ]] || return 0
  local root="$(dirname "$common_dir")"

  # gate_first_try: did the gate pass on the very first attempt for this
  # branch since the last pass? One counter file per branch, shared across
  # worktrees via the common .git dir's parent (the repo root).
  local attempt_dir="$root/.agents/state/gate-attempts"
  mkdir -p "$attempt_dir" 2>/dev/null
  local branch safe_branch attempt_file prior=0 result first_try
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  # printf, not echo: echo adds a trailing newline that `tr -c` turns into a
  # trailing underscore ("agent/dev-api-tester" -> "agent_dev-api-tester_").
  # ai-log.mjs and the ai-dash mod must derive the identical safe name.
  safe_branch="$(printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '_')"
  attempt_file="$attempt_dir/$safe_branch"
  [[ -f "$attempt_file" ]] && prior="$(cat "$attempt_file" 2>/dev/null)"
  [[ "$prior" =~ ^[0-9]+$ ]] || prior=0

  if (( FAILED )); then
    result=fail
    echo $(( prior + 1 )) > "$attempt_file" 2>/dev/null
  else
    result=pass
    rm -f "$attempt_file" 2>/dev/null
  fi
  if (( prior == 0 )); then
    [[ "$result" == pass ]] && first_try=true || first_try=false
  else
    first_try=false
  fi

  AILOG_TASK_TYPE="${AILOG_TASK_TYPE:-other}" \
  AILOG_AGENT="${AILOG_AGENT:-main}" \
  AILOG_GATE="$result" \
  AILOG_GATE_FIRST_TRY="$first_try" \
    node scripts/ai-log.mjs >/dev/null 2>&1 || true
  node scripts/ai-report.mjs --quiet >/dev/null 2>&1 || true
}
automatic_log

(( FAILED )) && { echo "GATE FAILED" >&2; exit 1; }
echo "Gate passed"
