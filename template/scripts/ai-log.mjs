#!/usr/bin/env node
// Append one execution record to .agents/log/executions.jsonl
// Usage:
//   node scripts/ai-log.mjs --task-type write-tests --agent dev-api-tester \
//     --model claude-opus-5 --size M --tokens-in 18420 --tokens-out 2310 \
//     --cache-read 15200 --cache-write 3100 --tool-calls 14 --duration 96 \
//     --gate pass --gate-first-try true --pr mechanical --outcome merged
//
// Only the fields below are ever written. No prompt text, no file paths, no
// source content — the log is designed to be safe to aggregate and publish.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOG = '.agents/log/executions.jsonl';
const TASKS_DOC = 'docs/tasks.md';

const ENUMS = {
  size: ['S', 'M', 'L'],
  gate: ['pass', 'fail', 'skip'],
  pr: ['mechanical', 'administrator', 'none'],
  outcome: ['merged', 'open', 'discarded', 'none'],
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith('--')) die(`unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) die(`${k} needs a value`);
    out[k.slice(2).replace(/-/g, '_')] = v;
  }
  return out;
}
function die(msg) { console.error(`ai-log: ${msg}`); process.exit(1); }
function int(v, name) {
  if (v === undefined) return 0;
  if (!/^\d+$/.test(v)) die(`${name} must be a non-negative integer, got "${v}"`);
  return Number(v);
}
function taxonomy() {
  if (!existsSync(TASKS_DOC)) return null;
  const rows = readFileSync(TASKS_DOC, 'utf8').matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm);
  const list = [...rows].map(m => m[1]);
  return list.length ? list : null;
}

const a = parseArgs(process.argv.slice(2));
if (!a.task_type) die('--task-type is required (see docs/tasks.md)');

const types = taxonomy();
if (types && !types.includes(a.task_type)) {
  die(`unknown task type "${a.task_type}". Known: ${types.join(', ')}\n` +
      `Add a row to ${TASKS_DOC} first if it is genuinely new.`);
}
for (const [field, allowed] of Object.entries(ENUMS)) {
  if (a[field] !== undefined && !allowed.includes(a[field])) {
    die(`--${field.replace(/_/g, '-')} must be one of: ${allowed.join(', ')}`);
  }
}

const rec = {
  ts: new Date().toISOString(),
  task_type: a.task_type,
  agent: a.agent || 'main',
  model: a.model || 'unknown',
  size: a.size || null,
  tokens_in: int(a.tokens_in, '--tokens-in'),
  tokens_out: int(a.tokens_out, '--tokens-out'),
  cache_read: int(a.cache_read, '--cache-read'),
  cache_write: int(a.cache_write, '--cache-write'),
  tool_calls: int(a.tool_calls, '--tool-calls'),
  duration_s: int(a.duration, '--duration'),
  gate: a.gate || 'skip',
  gate_first_try: a.gate_first_try === undefined ? null : a.gate_first_try === 'true',
  pr: a.pr || 'none',
  outcome: a.outcome || 'none',
};

mkdirSync(dirname(LOG), { recursive: true });
appendFileSync(LOG, JSON.stringify(rec) + '\n');
console.log(`logged ${rec.task_type} (${rec.agent}): ${rec.tokens_in} in, ${rec.tokens_out} out, gate ${rec.gate}`);
