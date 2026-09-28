#!/usr/bin/env node
// Append one execution record to <repo-root>/.agents/log/executions.jsonl
//
// Usage (manual):
//   node scripts/ai-log.mjs --task-type write-tests --agent dev-api-tester \
//     --model claude-opus-5 --size M --tokens-in 18420 --tokens-out 2310 \
//     --cache-read 15200 --cache-write 3100 --tool-calls 14 --duration 96 \
//     --gate pass --gate-first-try true --pr mechanical --outcome merged
//
// Usage (automatic — every field can come from an AI_* env var instead of a
// flag, so `scripts/gate.sh` can call this with no args at all):
//   AILOG_TASK_TYPE=fix-bug AILOG_AGENT=dev-api-tester AILOG_GATE=pass node scripts/ai-log.mjs
//
// A flag always wins over its env var. Only the fields below are ever
// written — no prompt text, no file paths, no source content — the log is
// designed to be safe to aggregate and publish.
//
// The log lives at the repo's shared root (resolved via
// `git rev-parse --git-common-dir`), not the current working directory, so
// every git worktree of this repo appends to the SAME file instead of
// fragmenting the data per worktree.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
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
const TASKS_DOC = join(ROOT, 'docs/tasks.md');

const ENUMS = {
  size: ['S', 'M', 'L'],
  gate: ['pass', 'fail', 'skip'],
  pr: ['mechanical', 'administrator', 'none'],
  outcome: ['merged', 'open', 'discarded', 'none'],
};

// field -> AI_<FIELD> env var name
const ENV_FALLBACK = {
  task_type: 'AILOG_TASK_TYPE',
  agent: 'AILOG_AGENT',
  model: 'AILOG_MODEL',
  size: 'AILOG_SIZE',
  tokens_in: 'AILOG_TOKENS_IN',
  tokens_out: 'AILOG_TOKENS_OUT',
  cache_read: 'AILOG_CACHE_READ',
  cache_write: 'AILOG_CACHE_WRITE',
  tool_calls: 'AILOG_TOOL_CALLS',
  duration: 'AILOG_DURATION',
  gate: 'AILOG_GATE',
  gate_first_try: 'AILOG_GATE_FIRST_TRY',
  pr: 'AILOG_PR',
  outcome: 'AILOG_OUTCOME',
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
  // Flags win; an AI_* env var fills anything the flags didn't set. This is
  // what lets scripts/gate.sh invoke this file with no flags at all.
  for (const [field, envName] of Object.entries(ENV_FALLBACK)) {
    if (out[field] === undefined && process.env[envName] !== undefined && process.env[envName] !== '') {
      out[field] = process.env[envName];
    }
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
if (!a.task_type) die('--task-type (or AILOG_TASK_TYPE) is required (see docs/tasks.md)');

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
