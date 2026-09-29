# ai-project-starter CLI

Node, zero dependencies. Wraps `template/` with four commands: `init`, `update`, `adopt`, `doctor`. Works the same on Windows, macOS and Linux — it shells out to `git` (which runs natively on Windows), never to `bash`.

## Why this exists

The starter itself is, and stays, a plain git repo (`template/` copied by `init-project.sh`). That's still the source of truth. This CLI adds two things that a bare template repo can't give you:

1. **No bash dependency for bootstrap.** `init-project.sh` needs a real `bash` (Git Bash/WSL). `init` here only needs `git` and `node`.
2. **A way to pull improvements into a project you already created.** A copied template diverges from the starter the moment it's copied — there was no way to bring later starter improvements into an existing project. `update` does that, conservatively: it only ever touches a file your project hasn't customized since the last sync; anything else is flagged, never silently overwritten.

## Install

Not published to npm yet. Until it is, run it straight from GitHub or from a local clone:

```bash
npx github:olavomello/ai-project-starter#main cli init my-project
# or, from a clone:
node ai-project-starter/cli/bin.js init my-project
```

Once published (`npm publish` from this `cli/` directory — needs an npm account and, first, a real `LICENSE` file at the repo root; `package.json` currently says `UNLICENSED` as a placeholder):

```bash
npx ai-project-starter init my-project
```

## Commands

```
ai-project-starter init <target-dir> [--ref <branch-or-tag>] [--source <path-or-url>]
ai-project-starter update [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--dry-run]
ai-project-starter adopt [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--force]
ai-project-starter doctor [<target-dir>]
```

`--source` defaults to this repo on GitHub; pass a local path (one containing a `template/` folder) to skip the network — useful for testing, or for an offline clone.

### `init`

Copies `template/`, writes `.ai-project-starter.json` (the manifest `update` needs), `git init`s, and makes the first commit. Then runs `doctor` and prints next steps. Equivalent to `init-project.sh`, minus the bash requirement.

### `update`

Compares your project's current files, the manifest's recorded baseline, and the starter's current files — a three-way diff by content hash, no external diff library:

| Local vs. baseline | Starter vs. baseline | Result |
|---|---|---|
| unchanged | unchanged | nothing to do |
| unchanged | changed | **auto-applied** |
| changed | unchanged | kept as-is (your edit becomes the new baseline) |
| changed | changed | **conflict** — `<file>.incoming` written, original left untouched |

`AGENTS.md`, `AGENT_TEAM.md`, `VERSION`, `CHANGELOG.md`, `docs/model-prices.json` and everything under `docs/agents/` and `docs/adr/` are **never** auto-applied or conflict-written — they're always project-specific. If the starter's copy changed, `update` just names the file and points at `CHANGELOG.md` for what changed there.

A file the starter dropped is removed locally only if you never touched it; a file the starter added is added. Run with `--dry-run` first to see the report without writing anything.

### `adopt`

For a project that doesn't have `.ai-project-starter.json` yet — created by `init-project.sh` before this CLI existed, or by hand. Records the project's current files as the baseline, so the *next* `update` diffs from today forward. It can't reconstruct what the project actually started from; if you know which starter tag it was created at, pass `--ref <that-tag>` so the recorded `starterVersion` is accurate for reference (it doesn't change what gets baselined).

### `doctor`

Structural checks only, no network: required files present, `VERSION` is valid SemVer, `CHANGELOG.md` has `[Unreleased]`, every `docs/agents/*.md` has `## CONFIGS`, `## SCOPE AND RULES` and a `Status:` line. Exit code `1` on any failure — safe to wire into CI. `init` runs this automatically at the end.

## What it deliberately doesn't do

No real merge. A conflict during `update` is never resolved for you — `<file>.incoming` sits next to your file and you decide, same as you would with `git diff --no-index`. Template-sync tools that promise automatic merging (create-react-app-style "eject", cookiecutter's various sync add-ons) have a long history of getting this wrong silently; this CLI would rather hand you two files and a diff command than guess.
