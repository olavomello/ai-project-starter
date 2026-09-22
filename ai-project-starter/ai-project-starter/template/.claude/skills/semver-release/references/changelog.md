# CHANGELOG conventions (Keep a Changelog 1.1.0)

Structure:

```
# Changelog
All notable changes to this project are documented here.
The format follows Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-09-21
### Added
- ...
### Fixed
- ...
```

Groups, in this order: Added, Changed, Deprecated, Removed, Fixed, Security. Omit empty groups.

Writing entries:
- One line per user-visible change, imperative or past tense, consistent within the file.
- Written for users, not a commit dump. Merge related commits into one line.
- Breaking change (pre- or post-1.0): prefix with `**BREAKING:**` and add a one-line migration note.
- Security fixes: describe impact, not exploit details.

Edge cases:
- Pre-release entries (`## [0.2.0-rc.1] - date`) are allowed. On final release, `bump.sh final` creates `[0.2.0]` with the new [Unreleased] content; earlier rc sections stay.
- Released sections are frozen except obvious typo fixes.
- Optional compare links at file bottom are not required by the gate.
