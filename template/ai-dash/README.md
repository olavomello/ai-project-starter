# ai-dash

Static monitoring page for this project's agent activity: tokens, cache reuse, gate pass rate, cost and per-agent breakdown.

Named `ai-dash` (not `dashboard`) so it doesn't collide with a `dashboard/` folder a project built on this starter might already have for its own product.

No build step, no framework — one HTML file plus `data.json`. The one external dependency is a loading-spinner library ([thinking-orbs-universal](https://libraries.dev/orbs)), loaded via `import()` from jsDelivr at runtime — no install, no bundler. If that CDN is unreachable, the page degrades to plain "loading"/"no data yet" text instead of breaking.

## Updating it

**Automatic:** `scripts/gate.sh` calls `ai-log.mjs` and `ai-report.mjs` itself at the end of every run — pass or fail — so `data.json` refreshes every time anyone runs the gate. No manual step, and it never affects the gate's pass/fail result. Richer entries (task type, agent, model, tokens) come from `AILOG_*` env vars set before the gate runs; see `AGENTS.md` section 4. Without them, the gate still logs a bare pass/fail.

Manual refresh is still available when you want it without running the full gate:

```bash
node scripts/ai-report.mjs      # aggregates executions.jsonl -> ai-dash/data.json
git add ai-dash/data.json && git commit -m "chore: refresh dashboard data"
```

Both the raw log and `data.json` are resolved from the repo's shared root (`git rev-parse --git-common-dir`), not the current directory — every git worktree of this project writes to the same files, so parallel agents don't fragment the data. The raw log itself is local and git-ignored; only the aggregate is committed, so the dashboard is as fresh as your last commit.

## Viewing it locally

`file://` won't work — the page `fetch`es `data.json`, which browsers block on the file protocol. Serve the folder:

```bash
node scripts/ai-dash.mjs            # recommended — also powers the Settings area below
# or: npx --yes serve ai-dash
# or: python3 -m http.server -d ai-dash 8000
```

`scripts/ai-dash.mjs [--port 4173]` is a small, dependency-free local server bound to
`127.0.0.1` only. It serves these same files, plus `GET`/`POST /api/config`, which the
page's **Settings** area (gear icon, top right) uses to read and flip the optional
`ai-dash` session mod (see `AGENTS.md` section 6 and
`docs/guides/claude-code.md`) without you editing `.claude/settings.json` by hand.
`npx serve` and a static host don't have that endpoint, so under those the Settings
row is read-only and shows the two commands to run instead
(`node scripts/ai-dash.mjs` and `node scripts/mod.mjs enable`).

`GET /api/live` feeds the **Live** panel at the top of the page: which agents are running right now, for how long, what finished recently and which paths are claimed. It is built from the `SubagentStart` / `SubagentStop` hooks in `.claude/settings.json`, which run `scripts/agent-live.mjs` and append counts-only lines (id, agent name, time) to the local, git-ignored `.agents/log/live.jsonl`. The page polls every 2 s while its tab is visible, and a run with a start but no stop for 30 minutes is treated as gone. Each row has a console icon: click it to open that agent's monitor, a small terminal with its latest tool calls (time, tool, target such as `Edit apps/web/page.tsx` or `Bash pnpm test`); the row itself already shows the latest call while the agent runs. A `PreToolUse` hook records those calls; targets are project-relative paths, the start of a command, a search pattern or a URL host, with credential-looking text masked, and prompts and tool output are never stored. The conversation of each Claude Code session shows as **Main session · <folder>** (a Claude Desktop worktree appears under its name), one run per turn: `UserPromptSubmit` starts it, `Stop` ends it, and since an interrupt doesn't fire `Stop`, a session with no activity for 10 minutes drops off. These hooks must be present where the session runs: in a git worktree that means `.claude/settings.json` and `scripts/agent-live.mjs` have to be committed, and the worktree's branch has to include that commit. Built-in subagents (`Explore`, `Plan`, ...) appear too; only roster agents have a description. Under `npx serve` or a static host there is no endpoint, so the panel stays hidden. See ADR 0004.

`GET /api/activity` feeds the **Activity** card under the Live panel: tool calls per bucket as stacked bars (the session's own calls and the subagents'), with a Hour / Day / Week / Month filter (last 24 hours, 14 days, 12 weeks, 12 months; weeks start on Monday, buckets use your local time zone) and the number of runs in the tooltip. The choice is remembered in the browser. The raw `live.jsonl` is trimmed to its newest 3000 lines; what is trimmed away is first added to hourly counters in the local, git-ignored `.agents/log/activity.json`, so the chart keeps months of history without keeping the sensitive detail. Counts only, like the Live panel it needs the local server and stays hidden on static hosting.

`GET /api/decisions` and `POST /api/decisions/approve` feed the **Pending decisions** icon in the header
(a checklist, with the number of items): it appears only where `docs/pending-decisions.md` exists, and opens a
list grouped by section with an **Approve** button per item. Approving asks first, then removes the row from the
file and queues its prompt in `.agents/state/decisions-inbox.jsonl`; the ai-dash mod hands the prompt to the
open Claude Code session, once (with no session open it waits, and the viewer says how many are waiting). The
approve endpoint has the same guard as the Settings switch: a local Host and Origin, a JSON content type, the
`X-AI-Dash` header and a body of exactly `{ "id": "<item id>" }`. Under `npx serve` or a static host there is
no endpoint, so the icon stays hidden. `node scripts/decisions.mjs list` prints the same items.

`GET /api/skills` feeds the **Skills and agents** viewer (book icon): name,
description, creation date, last usage and validity of every skill in `.claude/skills/`
and agent in `docs/agents/`, never their bodies. Last usage
is read from the local `.agents/log/usage.jsonl`. It is
local-only on purpose — skill text is not part of the counts-only `data.json`, so
under `npx serve` or a static host the viewer shows `node scripts/skills.mjs list`
instead.

The `POST` endpoint only accepts requests whose `Host` (and `Origin`, when sent) name
that same local server, with a `X-AI-Dash: 1` header and a small JSON body — enough to
stop another page or script from flipping the setting without you asking for it, not a
general-purpose API.

## Deploying to Vercel

Import the repository and set **Root Directory** to `ai-dash`. Framework preset: *Other*. No build command, no output directory — the files are served as they are. Every push that changes `data.json` redeploys.

### Read this before deploying

A Vercel deployment is **public by default**. Anyone with the URL sees the page.

The data is designed to be safe: `scripts/ai-report.mjs` writes only counts, sums and rates over the fixed task taxonomy in `docs/tasks.md`, plus the last 10 executions' task type, agent, model, gate result and token counts — never prompts, file paths, source content or branch names. That is deliberate — it is the reason the taxonomy is generic rather than free-form.

Even so, the aggregate reveals how much AI work this project consumes, which models it uses and how often the gate fails. **Turn on password protection before the first deploy** if the project is client work or anything unreleased:

1. Vercel dashboard → the project → **Settings → Deployment Protection**.
2. Under **Vercel Authentication** or **Password Protection** (naming has changed before — look for the protection/security section if these exact labels have moved), turn it on for Production, and Preview too if you use preview deploys.
3. Set a password, or gate it behind Vercel/SSO login if your plan supports that.
4. Redeploy. Every visitor now hits an auth prompt before the page loads.

This is a project setting, not a code change — nothing here needs updating when you turn it on. It is also the whole solution for a single-person dashboard: no accounts, no database, nothing to maintain. It only stops working as the answer if you outgrow "one shared password" and need per-person logins with individual access history — that is a different, heavier build (real auth, a user store) and not something this template takes on.

If you would rather not host it at all, serve it locally with the command above. Nothing about the dashboard requires a deploy.

**IP allowlisting**, if you want it as a second layer on top of the password: Vercel's Firewall (Pro plan and above, as of my last check — confirm on your plan) can restrict by IP or country at the edge, before the request reaches the page at all. It complements the password rather than replacing it — a dynamic IP or a shared network makes IP-only access fragile alone.

## What each number means

| Metric | Read it as |
|---|---|
| Cache read | Share of input tokens served from cache. Rising is good; a fall usually means something dynamic leaked into the stable prompt prefix. |
| Gate first pass | Share of tasks where `scripts/gate.sh` passed on the first run. This is the closest thing here to a quality signal, because it is measured rather than judged. |
| Est. cost | Computed from `docs/model-prices.json`: rounded average list prices shipped as a starting point, with the date they were entered in `updated`. Edit them in Settings > Model prices (or by hand), and re-check them against each provider's pricing page. A model that is missing from the file stays unpriced. |
| Agents running | Agents with a run open right now (from the live server) out of the agents that have logged work. It counts agents that announced their start through the `SubagentStart` hook; background commands and monitors do not announce themselves, so Claude Desktop's own "running tasks" figure can be higher. Runs that end without ever having started are folded into one "background tasks finished" line. |
| Success rate | Share of gate runs that passed, on any attempt. |
| Tokens by task type | Where the budget actually goes. A task type far above its share of the work is the first place to look for waste. |
