# Task taxonomy

Every logged execution carries a `task_type` from this list. Agents pick the closest match and never invent a new one without adding it here first.

Generic on purpose: a free-form task name would leak client names, unreleased features and internal jargon into the dashboard, which may be deployed publicly. A fixed taxonomy also makes executions comparable — the whole point of logging them.

| `task_type` | Covers |
|---|---|
| `plan` | Designing an approach, breaking work down, choosing an architecture |
| `build-feature` | New behavior, new endpoints, new UI |
| `fix-bug` | Correcting existing behavior |
| `refactor` | Restructuring without behavior change |
| `write-tests` | Adding or reworking tests |
| `review-code` | Reviewing a diff for quality or correctness |
| `review-security` | Security-focused review or audit |
| `fix-build` | Build, type, dependency or CI failures |
| `migrate-data` | Schema changes and data migrations |
| `write-docs` | Documentation, comments, runbooks |
| `research` | Investigating options, reading sources, comparing approaches |
| `release` | Version bump, changelog, tag |
| `ops` | Deploys, infra, monitoring, environment work |
| `other` | Anything that genuinely fits nothing above |

Adding a type: append a row, keep it generic enough that it would appear in several projects, and never encode a client, product or person in the name.
