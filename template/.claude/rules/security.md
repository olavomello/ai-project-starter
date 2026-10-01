---
paths:
  - "**/auth/**"
  - "**/*auth*"
  - "**/api/**"
  - "**/routes/**"
  - "**/middleware/**"
  - "**/*payment*"
  - "**/*webhook*"
  - "**/*upload*"
  - "**/migrations/**"
  - "**/*.sql"
  - "**/.env*"
---

# Security-sensitive path

You just opened a file matching a security-sensitive pattern — auth, data access,
uploads, payments, migrations, or anything reachable from the network.

Read `docs/guides/security.md` in full before writing or approving any change
here. This rule exists only to make sure that happens at the right moment —
the checklist itself lives in one place (the guide), not duplicated here.

Patterns are heuristic (the starter is stack-agnostic, so this can't be exact).
A match doesn't always mean the file is actually security-sensitive, and the
guide can apply to a file that doesn't match any pattern here — judgment still
applies.
