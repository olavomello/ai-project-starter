#!/usr/bin/env bash
# SemVer bump helper. Run from repo root.
# Usage:
#   bump.sh status
#   bump.sh patch|minor|major [--pre alpha|beta|rc] [--admin-approved] [--dry-run]
#   bump.sh pre   [--dry-run]     # X.Y.Z-rc.1 -> X.Y.Z-rc.2
#   bump.sh final [--dry-run]     # X.Y.Z-rc.N -> X.Y.Z
set -euo pipefail
CMD="${1:-}"; shift || true
PRE=""; ADMIN=0; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pre) PRE="${2:?--pre needs alpha|beta|rc}"; shift 2;;
    --admin-approved) ADMIN=1; shift;;
    --dry-run) DRY=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[[ -f VERSION ]] || { echo "VERSION missing" >&2; exit 1; }
CUR="$(tr -d '[:space:]' < VERSION)"
[[ "$CUR" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9A-Za-z.-]+))?$ ]] || { echo "invalid VERSION: $CUR" >&2; exit 1; }
MA=${BASH_REMATCH[1]}; MI=${BASH_REMATCH[2]}; PA=${BASH_REMATCH[3]}; CURPRE=${BASH_REMATCH[5]:-}

unreleased() { [[ -f CHANGELOG.md ]] && awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md | sed '/^[[:space:]]*$/d'; }

if [[ "$CMD" == "status" ]]; then
  echo "version: $CUR"
  LAST="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
  echo "last tag: ${LAST:-none}"
  echo "--- [Unreleased] ---"; unreleased || true
  echo "--- commit types since ${LAST:-start} ---"
  RANGE="${LAST:+$LAST..}HEAD"
  git log --format=%s "$RANGE" 2>/dev/null | sed -nE 's/^([a-z]+)(\([^)]*\))?(!)?:.*/\1\3/p' | sort | uniq -c || true
  git log --format=%B "$RANGE" 2>/dev/null | grep -q '^BREAKING CHANGE' && echo "  BREAKING CHANGE footer present" || true
  exit 0
fi

case "$CMD" in
  patch) NEW="$MA.$MI.$((PA+1))";;
  minor) NEW="$MA.$((MI+1)).0";;
  major)
    (( ADMIN )) || { echo "major requires --admin-approved (Administrator approval)" >&2; exit 1; }
    NEW="$((MA+1)).0.0";;
  pre)
    [[ "$CURPRE" =~ ^(alpha|beta|rc)\.([0-9]+)$ ]] || { echo "current version has no alpha/beta/rc.N pre-release" >&2; exit 1; }
    NEW="$MA.$MI.$PA-${BASH_REMATCH[1]}.$((BASH_REMATCH[2]+1))";;
  final)
    [[ -n "$CURPRE" ]] || { echo "current version is not a pre-release" >&2; exit 1; }
    NEW="$MA.$MI.$PA";;
  *) sed -n '2,8p' "$0"; exit 2;;
esac
# Finalizing into 1.0.0 also needs approval
if [[ "$NEW" == 1.0.0 || "$NEW" == 1.0.0-* ]] && (( ! ADMIN )) && [[ "$CMD" != major ]]; then
  echo "reaching 1.0.0 requires --admin-approved" >&2; exit 1
fi
if [[ -n "$PRE" ]]; then
  [[ "$PRE" =~ ^(alpha|beta|rc)$ ]] || { echo "--pre must be alpha|beta|rc" >&2; exit 1; }
  [[ "$CMD" =~ ^(patch|minor|major)$ ]] || { echo "--pre only with patch|minor|major" >&2; exit 1; }
  NEW="$NEW-$PRE.1"
fi

TODAY="$(date +%F)"
echo "bump: $CUR -> $NEW ($CMD${PRE:+, pre $PRE})"
[[ -n "$(unreleased || true)" ]] || echo "warning: [Unreleased] is empty — add changelog entries before releasing" >&2
if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null 2>&1; then echo "tag v$NEW already exists" >&2; exit 1; fi
(( DRY )) && { echo "(dry run, nothing written)"; exit 0; }

printf '%s\n' "$NEW" > VERSION
setjson() { [[ -f $1 ]] && sed -i -E "0,/^([[:space:]]*\"version\"[[:space:]]*:[[:space:]]*\")[^\"]*(\")/s//\1$NEW\2/" "$1" && echo "updated $1" || true; }
settoml() { [[ -f $1 ]] && sed -i -E "/^\[(project|package|tool\.poetry)\]/,/^\[/{s/^(version[[:space:]]*=[[:space:]]*\")[^\"]*(\")/\1$NEW\2/}" "$1" && echo "updated $1" || true; }
for f in package.json deno.json jsr.json; do setjson "$f"; done
for f in pyproject.toml Cargo.toml; do settoml "$f"; done

if [[ -f CHANGELOG.md ]]; then
  grep -q '^## \[Unreleased\]' CHANGELOG.md || { echo "CHANGELOG missing [Unreleased]" >&2; exit 1; }
  sed -i "0,/^## \[Unreleased\]/s//## [Unreleased]\n\n## [$NEW] - $TODAY/" CHANGELOG.md
  echo "updated CHANGELOG.md"
fi
echo "done. next: scripts/check-version.sh --release, then commit 'chore(release): v$NEW' and tag v$NEW"
