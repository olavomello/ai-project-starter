# 1. Record architecture decisions

## Status

Accepted

## Context

Architecturally significant decisions — a new external dependency, a changed data model, a new service or integration boundary, a changed deployment or delivery model — get made during the life of a project and then forgotten. Later, nobody can tell whether a constraint is still real or just habit, and the same debate happens again from scratch.

## Decision

We will record architecturally significant decisions as Architecture Decision Records (ADRs), one Markdown file per decision, numbered sequentially, in `docs/adr/`. The format follows Michael Nygard's ADR template (Title, Status, Context, Decision, Consequences) — see `docs/adr/template.md`.

Numbering and file naming follow the conventions of [npryce/adr-tools](https://github.com/npryce/adr-tools) (`NNNN-title-slug.md`, four-digit sequence, one status field, supersede by cross-linking rather than deleting), reimplemented here as `scripts/adr.mjs` — a small, dependency-free Node script instead of the original's bash, for the same cross-platform reason the rest of this starter's scripts are Node.

```
node scripts/adr.mjs new "<title>"                       # create the next ADR
node scripts/adr.mjs new "<title>" --supersedes 0003      # create it and mark 0003 superseded
node scripts/adr.mjs list                                 # number, status, title of every ADR
node scripts/adr.mjs toc [--write]                        # index; --write saves docs/adr/README.md
```

`AGENTS.md` requires an ADR whenever a change affects the overall architecture.

## Consequences

Decisions and their reasoning stay in the repo, next to the code they shaped, instead of in chat history or someone's memory. A superseded decision stays readable — the old ADR is marked superseded and links to the new one, never deleted — so the project's history of *why* is never lost, only extended. The cost is discipline: writing one before an architectural change lands, not after.
