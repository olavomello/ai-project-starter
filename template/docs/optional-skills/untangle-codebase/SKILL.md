---
name: untangle-codebase
description: Keep generated code lean and decoupled. Find and fix tangled structure — circular imports, modules that import too much, long call chains, god files and functions over the project's size knobs, copy-pasted logic, dead code — in small behavior-preserving steps, each proven by the gate. Use this when a change grew a file or function past the limits in AGENTS.md section 0, when new code duplicates existing code, when imports start to loop, before a release, or when asked to "clean up", "untangle", "reduce coupling" or "simplify" part of the codebase. Do NOT use for new features, bug fixes, or a rewrite.
creation-date: 2026-11-17 00:00:00
created-by: ai-project-starter
---

# Untangle codebase

Generated code tends to work first and rot second: one more branch in the same function, a helper pasted instead of reused, an import added to "just make it compile". This skill pays that down in small steps that never change behavior. It is optional; a project has it only if the Administrator chose it at setup (`node scripts/optional-skills.mjs status`).

## Ground rules

- **Behavior does not change.** No new features, no bug fixes mixed in (report a bug you find; fix it separately with its own test).
- **Green before and after.** Run `bash scripts/gate.sh` first. If it is not green, stop: a refactor on a red base cannot prove anything.
- **One kind of change per commit** (`refactor:`), so a bad step is one `git revert`.
- **No new dependencies, no new top-level files or directories** (AGENTS.md section 2). Split a file into a sibling in the same folder, not a new layer of folders.
- **Stay inside the ask.** Given a path, touch that path and the call sites it forces. With no path, only survey and report; do not refactor the whole repo in one go.
- **Tests that exist are the contract.** Never weaken or delete a test to make a step pass. If an area has no tests, add characterization tests for it first (they record what the code does today).

## Procedure

1. **Survey, don't guess.** Read `docs/repo-map.md`, then measure what the stack allows with a script, not by eye:
   - files and functions over the size knobs in AGENTS.md section 0 (default 800 / 50 lines);
   - import cycles and modules with the highest fan-out (imports) and fan-in (importers);
   - near-duplicate blocks (same logic in two or more places);
   - exports and files nothing references.
   Use what the project already has (its linter, `madge`, `go vet`, `cargo`, `ruff`, …) before writing a one-off script, and delete one-off scripts afterwards.
2. **Rank and propose.** List at most 5 findings, worst first, each with `file:line`, the smell, the intended fix and its size (S/M/L). Pick the top one unless the Administrator named another. Stop here and report if the task was only to survey.
3. **Fix one finding at a time**, with the smallest move that removes it:

   | Smell | Move |
   |---|---|
   | Import cycle | Move the shared piece (type, constant, helper) to the lower module both can import; invert the dependency, don't add a lazy import to hide it |
   | Module imports too much | It does too much: extract the unrelated part into its own module and import that |
   | Long call chain (`a.b().c().d`) | Give the first object one method that does the job; callers stop reaching through it |
   | Function over the limit | Extract named steps (pure ones first); keep the original as the readable outline |
   | File over the limit | Split along a seam already visible in its sections; re-export from the old path only if outside code imports it |
   | Duplicated logic | One implementation, called from both places; only when the copies really mean the same thing (two similar blocks that change for different reasons stay separate) |
   | Dead code | Delete it (git has it); confirm no dynamic use (string names, reflection, config) first |

4. **Prove it.** After each step: `bash scripts/gate.sh`. If it fails, undo that step and rethink; do not patch forward.
5. **Report**, as the final message: findings fixed (`file:line` before → after), findings left and why, gate result, anything that looked like a bug. Add a line under `## [Unreleased]` → Changed in `CHANGELOG.md` only if a public path or behavior-visible name moved.

## When to stop

Stop and report instead of continuing when a step needs a behavior change, touches a public API, needs a new dependency, or the area is large enough that the diff passes ~400 lines (the "mechanical PR" ceiling in `AGENT_TEAM.md`). Splitting the work into several small PRs is the answer, not one large one.

## Keep it from coming back

Small, targeted habits beat periodic clean-ups: before adding code, search for an existing function that already does it; when a function crosses the size knob, split it in the same change; never add an import only to satisfy the compiler without checking which direction the dependency should point.
