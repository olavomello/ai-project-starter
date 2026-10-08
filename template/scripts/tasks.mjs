#!/usr/bin/env node
// Tasks: the task taxonomy (docs/tasks.md) with what is happening on each one, for the AI Dash Tasks card.
//
// The list and its order come from docs/tasks.md. What is happening comes from two places:
//   - .agents/log/executions.jsonl  — every gate run, with its task_type and agent (how often, and when last);
//   - .agents/state/active-tasks.json — the "working on it now" marker an agent sets with `start` and clears with `done`.
// A task is "in progress" while it has a marker; an agent is "working" on it when that agent has a run open in the live log.
// Markers older than MARKER_TTL_MS are ignored, so a session that died without `done` does not pin a task forever.
//
// Usage:
//   node scripts/tasks.mjs list [--json]
//   node scripts/tasks.mjs start <task_type> [--agent <name>]
//   node scripts/tasks.mjs done <task_type>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usageRoot } from './skills.mjs';

export const MARKER_TTL_MS = 2 * 60 * 60 * 1000;
export const RECENT_MS = 60 * 60 * 1000;
const TYPE = /^[a-z][a-z0-9-]{0,40}$/;

/** The rows of the taxonomy table, in the order the file lists them: `[{ type, covers }]`. */
export function parseTaxonomy(text) {
  const out = [];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*(.*?)\s*\|\s*$/);
    if (m && !out.some((t) => t.type === m[1])) out.push({ type: m[1], covers: m[2] });
  }
  return out;
}

const markerFile = (dir) => join(usageRoot(dir), '.agents', 'state', 'active-tasks.json');

function readMarkers(dir, now) {
  try {
    const all = JSON.parse(readFileSync(markerFile(dir), 'utf8'));
    return Object.fromEntries(Object.entries(all).filter(([t, v]) => TYPE.test(t) && v && now - Number(v.since) < MARKER_TTL_MS));
  } catch { return {}; }
}

function readExecutions(dir) {
  const file = join(usageRoot(dir), '.agents', 'log', 'executions.jsonl');
  if (!existsSync(file)) return [];
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const t = Date.parse(r.ts);
      if (r.task_type && Number.isFinite(t)) rows.push({ type: String(r.task_type), agent: String(r.agent || ''), t });
    } catch { /* skip a torn line */ }
  }
  return rows;
}

/**
 * The Tasks card's data: every taxonomy task, in file order, with its status.
 * `running` is the names of the agents that have a run open right now (`main` counts as one).
 * Statuses: `working` (marker, and its agent is running), `in-progress` (marker only), `recent` (a run in the last hour), `idle`.
 */
export function readTasks(dir = '.', { running = [], now = Date.now() } = {}) {
  const path = join(dir, 'docs', 'tasks.md');
  const taxonomy = existsSync(path) ? parseTaxonomy(readFileSync(path, 'utf8')) : [];
  const markers = readMarkers(dir, now);
  const runs = readExecutions(dir);
  const live = new Set(running);
  return taxonomy.map((task, i) => {
    const mine = runs.filter((r) => r.type === task.type);
    const last = mine.reduce((a, r) => (!a || r.t > a.t ? r : a), null);
    const marker = markers[task.type] || null;
    const agent = marker ? String(marker.agent || '') : '';
    let status = 'idle';
    if (marker) status = agent && live.has(agent) ? 'working' : 'in-progress';
    else if (last && now - last.t < RECENT_MS) status = 'recent';
    return {
      order: i + 1, type: task.type, covers: task.covers, status, agent,
      since: marker ? Number(marker.since) : null,
      runs: mine.length, lastRun: last ? last.t : null, lastAgent: last ? last.agent : '',
    };
  });
}

/** Marks a task as being worked on. Returns `{ ok }` or `{ ok: false, error }`. */
export function startTask(dir, type, agent = '', now = Date.now()) {
  if (!TYPE.test(String(type))) return { ok: false, error: 'not a task type' };
  const path = join(dir, 'docs', 'tasks.md');
  const known = existsSync(path) ? parseTaxonomy(readFileSync(path, 'utf8')) : [];
  if (!known.some((t) => t.type === type)) return { ok: false, error: `"${type}" is not in docs/tasks.md` };
  if (agent && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(agent)) return { ok: false, error: 'not an agent name' };
  const markers = readMarkers(dir, now);
  markers[type] = { agent, since: now };
  const file = markerFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(markers, null, 2)}\n`);
  return { ok: true };
}

/** Clears the marker of a task. */
export function finishTask(dir, type, now = Date.now()) {
  const markers = readMarkers(dir, now);
  const had = type in markers;
  delete markers[type];
  const file = markerFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(markers, null, 2)}\n`);
  return { ok: true, had };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] || '' : ''; };
  if (cmd === 'list') {
    const tasks = readTasks('.');
    if (a === '--json') console.log(JSON.stringify(tasks));
    else for (const t of tasks) console.log(`${String(t.order).padStart(2)}  ${t.status.padEnd(11)} ${t.type.padEnd(16)} ${t.agent}`);
  } else if (cmd === 'start' && a) {
    const r = startTask('.', a, flag('--agent'));
    console.log(r.ok ? `${a}: in progress` : `error: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'done' && a) {
    const r = finishTask('.', a);
    console.log(r.had ? `${a}: done` : `${a}: was not marked`);
  } else {
    console.log('Usage: node scripts/tasks.mjs list [--json] | start <task_type> [--agent <name>] | done <task_type>');
    process.exit(cmd ? 1 : 0);
  }
}
