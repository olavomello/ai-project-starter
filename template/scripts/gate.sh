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

GATE=.claude/skills/semver-release/scripts/check-version.sh
if [[ -f $GATE ]]; then
  echo "--- version gate"
  if (( RELEASE )); then bash "$GATE" --release || FAILED=1; else bash "$GATE" || FAILED=1; fi
else
  echo "skip: version gate (script missing)"
fi

(( FAILED )) && { echo "GATE FAILED" >&2; exit 1; }
echo "Gate passed"
