# Dashboard

Static monitoring page for this project's agent activity: tokens, cache reuse, gate pass rate, cost and per-agent breakdown.

No build step, no framework, no dependencies — one HTML file plus `data.json`.

## Updating it

```bash
node scripts/ai-report.mjs      # aggregates .agents/log/executions.jsonl -> dashboard/data.json
git add dashboard/data.json && git commit -m "chore: refresh dashboard data"
```

The raw log is local and git-ignored. Only the aggregate is committed, so the dashboard is as fresh as your last commit.

## Viewing it locally

`file://` won't work — the page `fetch`es `data.json`, which browsers block on the file protocol. Serve the folder:

```bash
npx --yes serve dashboard
# or: python3 -m http.server -d dashboard 8000
```

## Deploying to Vercel

Import the repository and set **Root Directory** to `dashboard`. Framework preset: *Other*. No build command, no output directory — the files are served as they are. Every push that changes `data.json` redeploys.

### Read this before deploying

A Vercel deployment is **public by default**. Anyone with the URL sees the page.

The data is designed to be safe: `scripts/ai-report.mjs` writes only counts, sums and rates over the fixed task taxonomy in `docs/tasks.md`. No prompts, no file paths, no source content, no branch names. That is deliberate — it is the reason the taxonomy is generic rather than free-form.

Even so, the aggregate reveals how much AI work this project consumes, which models it uses and how often the gate fails. For client work or anything unreleased, turn on Vercel's deployment protection (password or SSO) in the project's settings before the first deploy. The exact setting name and location change over time — look under the project's protection or security settings.

If you would rather not host it at all, serve it locally with the command above. Nothing about the dashboard requires a deploy.

## What each number means

| Metric | Read it as |
|---|---|
| Cache read | Share of input tokens served from cache. Rising is good; a fall usually means something dynamic leaked into the stable prompt prefix. |
| Gate first pass | Share of tasks where `scripts/gate.sh` passed on the first run. This is the closest thing here to a quality signal, because it is measured rather than judged. |
| Est. cost | Computed from `docs/model-prices.json`, which you fill in yourself. Blank until then — a wrong price is worse than no price. |
| Tokens by task type | Where the budget actually goes. A task type far above its share of the work is the first place to look for waste. |
