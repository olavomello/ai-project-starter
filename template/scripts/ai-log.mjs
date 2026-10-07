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
// Measured fields (model, size, tokens_in, tokens_out, cache_read,
// cache_write, tool_calls, duration) have a third source, ahead of the env
// var: the optional ai-dash mod's per-branch usage file (see
// mods/ai-dash/README.md at the repo root — vendored separately, not
// copied into this template). Precedence is flag > usage file > env var >
// default. The usage file is deleted once its values are read, whether or
// not it changed anything (a flag can still override a measured field); a
// missing or malformed file is ignored silently.
//
// `tokens_in` means TOTAL input tokens, cache included: uncached input plus
// cache read plus cache write. That's what `cache_read / tokens_in` in
// ai-report.mjs assumes, and what the usage file's `uncached_in` +
// `cache_read` + `cache_write` already adds up to.
//
// Only the fields below are ever written — no prompt text, no file paths,
// no source content — the log is designed to be safe to aggregate and
// publish.
//
// The log lives at the repo's shared root (resolved via
// `git rev-parse --git-common-dir`), not the current working directory, so
// every git worktree of this repo appends to the SAME file instead of
// fragmenting the data per worktree. The usage file is resolved against the
// same root, under the sanitized branch name (see the comment in
// scripts/gate.sh for the exact sanitizing rule — ai-log.mjs, gate.sh and
// the mod must all derive the identical name).
import { appendFileSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
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

function currentBranch() {
  try {
    return execFileSync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim() || 'unknown';
  } catch { return 'unknown'; }
}

// Same transform as scripts/gate.sh's `printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '_'`.
function sanitizeBranch(branch) {
  return String(branch).replace(/[^A-Za-z0-9._-]/g, '_');
}

const ROOT = repoRoot();
const LOG = join(ROOT, '.agents/log/executions.jsonl');
const TASKS_DOC = join(ROOT, 'docs/tasks.md');
const USAGE_DIR = join(ROOT, '.agents/state/usage');
const OWN_USAGE = `${sanitizeBranch(currentBranch())}.json`;

/**
 * Reads and deletes the ai-dash usage files, mapped onto ai-log's field names.
 *
 * The mod writes one file per *session* branch, but a gate often runs on a different branch than the
 * session that did the work (an agent's worktree, main). So a gate run takes the usage of every
 * branch measured since the last run: totals are summed, and the model comes from this branch's own
 * file when it has one, otherwise from the file that measured the most tokens. Size is only taken
 * from this branch's file, since a task size belongs to one session.
 */
function readUsageFiles() {
  if (!existsSync(USAGE_DIR)) return {};
  const parsed = [];
  for (const name of readdirSync(USAGE_DIR).filter((f) => f.endsWith('.json'))) {
    const path = join(USAGE_DIR, name);
    try {
      const u = JSON.parse(readFileSync(path, 'utf8'));
      if (u && typeof u === 'object') parsed.push({ name, u });
    } catch { /* malformed — ignored silently */ }
    try { rmSync(path); } catch { /* best-effort */ }
  }
  if (!parsed.length) return {};
  const num = (u, k) => Number(u[k]) || 0;
  const sum = (k) => parsed.reduce((n, { u }) => n + num(u, k), 0);
  const measured = ({ u }) => num(u, 'uncached_in') + num(u, 'cache_read') + num(u, 'cache_write') + num(u, 'out');
  const own = parsed.find((x) => x.name === OWN_USAGE);
  const biggest = [...parsed].sort((x, y) => measured(y) - measured(x));
  const model = (own && own.u.model) || (biggest.find((x) => x.u.model) || { u: {} }).u.model;
  return {
    tokens_in: sum('uncached_in') + sum('cache_read') + sum('cache_write'),
    tokens_out: sum('out'),
    cache_read: sum('cache_read'),
    cache_write: sum('cache_write'),
    tool_calls: sum('tool_calls'),
    duration: sum('duration_s'),
    model: model || undefined,
    size: (own && own.u.size) || undefined,
  };
}

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
  return out;
}

/**
 * Resolves every field's final value: an explicit flag wins outright; next,
 * for the measured fields, the ai-dash usage file (if present); next,
 * the AILOG_* env var; otherwise the field is left unset (a default fills
 * it in below). This is what lets scripts/gate.sh invoke this file with no
 * flags at all, and what lets the mod's usage file improve on a bare
 * AILOG_* run without needing to change how gate.sh calls either.
 */
function resolveFields(flags, usage) {
  const out = { ...flags };
  for (const field of Object.keys(ENV_FALLBACK)) {
    if (out[field] !== undefined) continue;
    if (usage[field] !== undefined) { out[field] = usage[field]; continue; }
    const envName = ENV_FALLBACK[field];
    if (process.env[envName] !== undefined && process.env[envName] !== '') {
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

const a = resolveFields(parseArgs(process.argv.slice(2)), readUsageFiles());
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
