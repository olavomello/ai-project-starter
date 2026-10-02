#!/usr/bin/env node
// Aggregate .agents/log/executions.jsonl into ai-dash/data.json and print a summary.
// Usage: node scripts/ai-report.mjs [--quiet]
//
// The output holds AGGREGATES ONLY — counts, sums and rates over a fixed task
// taxonomy. It never contains prompt text, file paths or source content, so it is
// safe to commit and deploy. See docs/tasks.md.
//
// Paths resolve against the repo's shared root (`git rev-parse --git-common-dir`),
// not the current working directory, so this reads and writes the same files
// regardless of which git worktree it runs from.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

function repoRoot() {
  try {
    const gitCommonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (gitCommonDir) return dirname(gitCommonDir);
  } catch { /* not a git repo, or git missing — fall back to cwd */ }
  return process.cwd();
}

const ROOT = repoRoot();
const LOG = join(ROOT, '.agents/log/executions.jsonl');
const OUT = join(ROOT, 'ai-dash/data.json');
const PRICES = join(ROOT, 'docs/model-prices.json');
const quiet = process.argv.includes('--quiet');

if (!existsSync(LOG)) {
  console.error(`ai-report: no log at ${LOG} yet — nothing to aggregate.`);
  process.exit(1);
}

const recs = readFileSync(LOG, 'utf8').split('\n')
  .filter(l => l.trim())
  .map((l, i) => { try { return JSON.parse(l); } catch { console.error(`ai-report: skipping malformed line ${i + 1}`); return null; } })
  .filter(Boolean);

if (!recs.length) { console.error('ai-report: log is empty'); process.exit(1); }

let prices = null;
if (existsSync(PRICES)) {
  try {
    const p = JSON.parse(readFileSync(PRICES, 'utf8'));
    const filled = Object.entries(p.models || {}).filter(([k, v]) =>
      !k.startsWith('example') && (v.in > 0 || v.out > 0));
    if (filled.length) prices = Object.fromEntries(filled);
  } catch { console.error(`ai-report: ${PRICES} is not valid JSON — skipping cost`); }
}

const NUM = ['tokens_in', 'tokens_out', 'cache_read', 'cache_write', 'tool_calls', 'duration_s'];
const zero = () => Object.fromEntries(NUM.map(k => [k, 0]));
const add = (t, r) => { for (const k of NUM) t[k] += r[k] || 0; return t; };

function group(key) {
  const m = new Map();
  for (const r of recs) {
    const g = r[key] ?? 'unknown';
    if (!m.has(g)) m.set(g, { [key]: g, executions: 0, ...zero(), gate_pass: 0, gate_first: 0, gate_rated: 0 });
    const t = m.get(g);
    t.executions++; add(t, r);
    if (r.gate === 'pass') t.gate_pass++;
    if (r.gate_first_try !== null) { t.gate_rated++; if (r.gate_first_try) t.gate_first++; }
    m.set(g, t);
  }
  return [...m.values()].map(t => ({
    ...t,
    gate_first_pass: t.gate_rated ? +(t.gate_first / t.gate_rated).toFixed(3) : null,
  })).sort((a, b) => b.tokens_in - a.tokens_in);
}

const totals = recs.reduce((t, r) => { t.executions++; return add(t, r); }, { executions: 0, ...zero() });
const rated = recs.filter(r => r.gate_first_try !== null);
const gated = recs.filter(r => r.gate !== 'skip');

function cost() {
  if (!prices) return null;
  let c = 0, priced = 0;
  for (const r of recs) {
    const p = prices[r.model];
    if (!p) continue;
    priced++;
    // tokens_in is TOTAL input (uncached + cache_read + cache_write — see
    // ai-log.mjs's header comment), so pricing it at the plain `in` rate on
    // top of cache_read/cache_write would charge the cached portion twice.
    // Only the uncached remainder is priced at `in`.
    const uncachedIn = Math.max(0, r.tokens_in - r.cache_read - r.cache_write);
    c += (uncachedIn * (p.in || 0) + r.tokens_out * (p.out || 0)
       + r.cache_read * (p.cache_read || 0) + r.cache_write * (p.cache_write || 0)) / 1e6;
  }
  return { usd: +c.toFixed(4), priced_executions: priced, unpriced: recs.length - priced };
}

const byDayMap = new Map();
for (const r of recs) {
  const d = (r.ts || '').slice(0, 10) || 'unknown';
  if (!byDayMap.has(d)) byDayMap.set(d, { day: d, executions: 0, ...zero() });
  const t = byDayMap.get(d); t.executions++; add(t, r);
}

const prSplit = recs.reduce((s, r) => { if (r.pr && r.pr !== 'none') s[r.pr] = (s[r.pr] || 0) + 1; return s; },
  { mechanical: 0, administrator: 0 });

const SAFE_FIELDS = ['ts', 'task_type', 'agent', 'model', 'gate', 'tokens_in', 'tokens_out'];
const recent = [...recs]
  .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
  .slice(0, 10)
  .map(r => Object.fromEntries(SAFE_FIELDS.map(k => [k, r[k]])));

const data = {
  generated_at: new Date().toISOString(),
  log_records: recs.length,
  recent,
  totals,
  rates: {
    cache_read_ratio: totals.tokens_in ? +(totals.cache_read / totals.tokens_in).toFixed(3) : null,
    gate_pass: gated.length ? +(gated.filter(r => r.gate === 'pass').length / gated.length).toFixed(3) : null,
    gate_first_pass: rated.length ? +(rated.filter(r => r.gate_first_try).length / rated.length).toFixed(3) : null,
  },
  cost: cost(),
  pr_split: prSplit,
  by_day: [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
  by_task: group('task_type'),
  by_agent: group('agent'),
  by_model: group('model'),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');

if (!quiet) {
  const pct = v => v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`;
  console.log(`wrote ${OUT} from ${recs.length} records`);
  console.log(`  tokens in ${totals.tokens_in.toLocaleString()}  out ${totals.tokens_out.toLocaleString()}`);
  console.log(`  cache read ratio ${pct(data.rates.cache_read_ratio)}   gate first pass ${pct(data.rates.gate_first_pass)}`);
  console.log(`  cost ${data.cost ? '$' + data.cost.usd : 'not computed (fill docs/model-prices.json)'}`);
  console.log(`  top task: ${data.by_task[0]?.task_type ?? 'n/a'}`);
}
