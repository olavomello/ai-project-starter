# Functions

Reusable prompts and small algorithms the agents (or you) noticed they keep
rewriting, saved once and called by name. One file per function in this
folder, written as:

```
function nameInCamelCase( param : Type ) {
  ---
  What it does.
  Creation date : YYYY-MM-DD HH:MM:SS
  Created by : <who>
  Last usage : 0000-00-00 00:00:00
  ---
  The prompt, using the parameters, saying what is returned.
}
```

Create one with `node scripts/functions.mjs new <name> --params "a : Type" --desc "..."`;
validate with `check` (the gate runs it). Record a use with `use <name>` — the
real last-usage time lives in the local usage log, shown by `list` and in the
ai-dash viewer, so the files don't change on every call. Pick the right home first:
a procedure with steps is a **skill**; a deterministic algorithm is a **script**;
only a short, parameterised prompt belongs here. This table is generated
(`node scripts/functions.mjs index`) — don't edit it by hand.

| Function | Parameters | Description | Created | By |
|---|---|---|---|---|
| [`dateFormat`](dateFormat.md) | dte : Date | Date time format to specific global pattern YYYY-MM-DD HH:MM:SS | 2026-10-04 22:14:00 | admin |
