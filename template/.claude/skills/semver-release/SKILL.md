---
name: semver-release
description: Run a project release following SemVer 2.0.0 and Keep a Changelog — decide the bump, update VERSION and manifests, promote CHANGELOG [Unreleased], validate with the version gate, and prepare the vX.Y.Z tag. Use this whenever the task mentions a release, version bump, new version, tagging, changelog promotion, "cut a release", pre-release (alpha/beta/rc), moving to 1.0.0, or when the version gate fails — even if the user doesn't say "SemVer". Also use when an agent must report its version impact to Main.
---

# SemVer Release

Deterministic release workflow. Scripts do the mechanical work; you make the decisions.
Do not edit VERSION, manifests, or CHANGELOG release headers by hand — use `scripts/bump.sh`, because hand edits are the main source of version drift.

## Who may do what

- **Non-Main agents:** only report version impact (format below) and add lines under `## [Unreleased]`. Stop there.
- **Main:** runs this whole workflow.
- **Administrator:** must approve `1.0.0` and every MAJOR. If approval isn't explicit in the conversation or task, stop and ask.

Version-impact report (non-Main agents):

```
version-impact: none|patch|minor|major
reason: <one line>
breaking: yes|no
changelog: <one line for [Unreleased]>
```

## Workflow (Main)

1. **Inspect state** — one call, no file browsing:
   `bash <skill>/scripts/bump.sh status`
   It prints current version, last tag, [Unreleased] content, and commit types since the last tag.

2. **Decide the bump** from the status output and agents' reports:

   | Scope | < 1.0.0 | ≥ 1.0.0 |
   |---|---|---|
   | only fix/security/internal | patch | patch |
   | any feat | minor | minor |
   | any breaking (`!`, `BREAKING CHANGE`) | minor | major (Admin approval) |
   | docs/ci/test/refactor only | no release | no release |

   Pre-1.0 breaking changes need a migration note under Changed/Removed. If `[Unreleased]` is empty but commits exist, write the entries first — a release without changelog lines is incomplete.

3. **Dry run, then apply:**
   ```
   bash <skill>/scripts/bump.sh <patch|minor|major> [--pre alpha|beta|rc] --dry-run
   bash <skill>/scripts/bump.sh <patch|minor|major> [--pre alpha|beta|rc]
   ```
   Other forms: `bump.sh pre` (rc.1 → rc.2), `bump.sh final` (drop pre-release), `bump.sh major --admin-approved` (required for 0.x → 1.0.0 and any major).

4. **Validate:** `bash <skill>/scripts/check-version.sh --release`. On failure, fix the reported item and rerun; don't reason around it.

5. **Commit and tag** (only after the gate passes):
   ```
   git add -A && git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   bash <skill>/scripts/check-version.sh --release
   ```
   Push only if the task says so: `git push --follow-tags`.

6. **Report** in ≤6 lines: old → new version, bump reason, gate result, tag, pushed yes/no.

## Hard rules

- Tags are immutable. If a tag was wrong, release a new PATCH; never move or delete it.
- Build metadata (`+...`) never goes into VERSION or tags.
- Never bump just because files changed; a release needs a release purpose.
- Changelog details and edge cases: read `references/changelog.md` only if needed.

`<skill>` = this skill's directory (e.g. `.claude/skills/semver-release`).
