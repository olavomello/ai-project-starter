#!/usr/bin/env bash
# Version quality gate. Usage: scripts/check-version.sh [--release]
set -euo pipefail
RELEASE=0; [[ "${1:-}" == "--release" ]] && RELEASE=1
fail() { echo "FAIL: $*" >&2; FAILED=1; }
ok()   { echo "ok:   $*"; }
FAILED=0

[[ -f VERSION ]] || { echo "FAIL: VERSION missing" >&2; exit 1; }
V="$(tr -d '[:space:]' < VERSION)"

# Official SemVer 2.0.0 regex (semver.org); build metadata not allowed in VERSION.
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?$'
if [[ "$V" =~ $SEMVER ]]; then ok "VERSION $V is valid SemVer"; else fail "VERSION '$V' is not valid SemVer"; fi

check() { # file, extracted version
  if [[ -z "$2" ]]; then fail "$1: version field not found"
  elif [[ "$2" == "$V" ]]; then ok "$1 = $2"
  else fail "$1 = $2, expected $V"; fi
}
json_ver() { grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" | head -n1 | sed 's/.*"\([^"]*\)"$/\1/'; }
toml_ver() { sed -n '/^\[\(project\|package\|tool\.poetry\)\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p}' "$1" | head -n1; }

for f in package.json deno.json jsr.json; do [[ -f $f ]] && check "$f" "$(json_ver "$f")"; done
for f in pyproject.toml Cargo.toml; do [[ -f $f ]] && check "$f" "$(toml_ver "$f")"; done

if [[ -f CHANGELOG.md ]]; then
  grep -q '^## \[Unreleased\]' CHANGELOG.md && ok "CHANGELOG has [Unreleased]" || fail "CHANGELOG missing [Unreleased]"
  if (( RELEASE )); then
    grep -Eq "^## \[${V//./\\.}\] - [0-9]{4}-[0-9]{2}-[0-9]{2}" CHANGELOG.md \
      && ok "CHANGELOG has [$V]" || fail "CHANGELOG missing '## [$V] - YYYY-MM-DD'"
  fi
else
  fail "CHANGELOG.md missing"
fi

if git rev-parse --git-dir >/dev/null 2>&1; then
  for t in $(git tag --points-at HEAD 'v*' 2>/dev/null); do
    [[ "$t" == "v$V" ]] && ok "tag $t matches" || fail "tag $t on HEAD does not match v$V"
  done
  if (( RELEASE )); then
    TAG_SHA="$(git rev-list -n1 "v$V" 2>/dev/null || true)"
    if [[ -z "$TAG_SHA" ]]; then echo "info: tag v$V not created yet"
    elif [[ "$TAG_SHA" != "$(git rev-parse HEAD)" ]]; then fail "tag v$V exists on another commit (tags are immutable; bump PATCH)"
    fi
  fi
fi

(( FAILED )) && { echo "Version gate FAILED" >&2; exit 1; }
echo "Version gate passed"
