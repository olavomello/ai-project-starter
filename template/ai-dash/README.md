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
npx --yes serve ai-dash
# or: python3 -m http.server -d ai-dash 8000
```

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
| Est. cost | Computed from `docs/model-prices.json`, which you fill in yourself. Blank until then — a wrong price is worse than no price. |
| Tokens by task type | Where the budget actually goes. A task type far above its share of the work is the first place to look for waste. |
