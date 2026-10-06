#!/usr/bin/env node
// Live agent activity for ai-dash.
//
// Claude Code fires `SubagentStart` and `SubagentStop` hooks around every
// subagent run. `.claude/settings.json` points both at this script, which
// appends one line per event to the local, git-ignored
// `.agents/log/live.jsonl` (shared by every worktree, like the usage log).
// `readLive` turns that log into "running now" and "recently finished", which
// `scripts/ai-dash.mjs` serves as `GET /api/live` for the dashboard's Live panel.
//
// The log holds ids, agent names and times only — never prompts, paths or output.
//
// Usage (as a hook; reads the hook's JSON from stdin, always exits 0):
//   node scripts/agent-live.mjs start
//   node scripts/agent-live.mjs stop
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usageRoot } from './skills.mjs';

export const LIVE_LOG = join('.agents', 'log', 'live.jsonl');
const MAX_BYTES = 512 * 1024; // past this, keep only the newest lines
const KEEP_LINES = 600;
export const STALE_MS = 30 * 60 * 1000; // a start with no stop after this is treated as gone

const logFile = (dir) => join(usageRoot(dir), LIVE_LOG);

/** Appends one start/stop event. `payload` is the hook's stdin JSON. */
export function recordEvent(kind, payload, dir = '.', now = Date.now()) {
  if (kind !== 'start' && kind !== 'stop') throw new Error(`unknown event "${kind}"`);
  const id = String(payload?.agent_id || '');
  if (!id) return false; // the main thread has no agent_id; nothing to track
  const file = logFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  const line = JSON.stringify({
    t: now, event: kind, id,
    type: String(payload.agent_type || 'unknown').slice(0, 80),
    session: String(payload.session_id || '').slice(0, 64),
  });
  appendFileSync(file, line + '\n');
  try {
    if (statSync(file).size > MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, lines.slice(-KEEP_LINES).join('\n') + '\n');
    }
  } catch { /* trimming is best effort */ }
  return true;
}

function readEvents(dir) {
  const file = logFile(dir);
  if (!existsSync(file)) return [];
  const events = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e.t === 'number' && e.id && (e.event === 'start' || e.event === 'stop')) events.push(e);
    } catch { /* skip a torn line */ }
  }
  return events;
}

/** Advisory claims from `agent-team.sh claim`: `.agents/locks/<name>/{holder,since,globs}`. */
function readClaims(dir) {
  const locks = join(usageRoot(dir), '.agents', 'locks');
  if (!existsSync(locks)) return [];
  const read = (d, f) => { try { return readFileSync(join(d, f), 'utf8').trim(); } catch { return ''; } };
  return readdirSync(locks, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const d = join(locks, e.name);
      return { name: e.name, holder: read(d, 'holder'), since: read(d, 'since'), globs: read(d, 'globs').split('\n').filter(Boolean) };
    });
}

/**
 * What is running now and what just finished.
 * `running`: started, no stop yet, and younger than `staleMs`.
 * `recent`: finished runs, newest first, at most `recent` of them.
 */
export function readLive(dir = '.', { now = Date.now(), staleMs = STALE_MS, recent = 12 } = {}) {
  const runs = new Map();
  for (const e of readEvents(dir)) {
    const r = runs.get(e.id) || { id: e.id, type: e.type, started: null, stopped: null };
    if (e.event === 'start') { r.started = r.started ?? e.t; r.type = e.type; }
    else { r.stopped = e.t; if (r.started === null) r.started = e.t; }
    runs.set(e.id, r);
  }
  const all = [...runs.values()];
  const running = all
    .filter((r) => r.stopped === null && now - r.started < staleMs)
    .sort((a, b) => a.started - b.started)
    .map((r) => ({ id: r.id, type: r.type, since: r.started, seconds: Math.max(0, Math.round((now - r.started) / 1000)) }));
  const finished = all
    .filter((r) => r.stopped !== null)
    .sort((a, b) => b.stopped - a.stopped)
    .slice(0, recent)
    .map((r) => ({ id: r.id, type: r.type, started: r.started, stopped: r.stopped, seconds: Math.max(0, Math.round((r.stopped - r.started) / 1000)) }));
  return { now, running, recent: finished, claims: readClaims(dir) };
}

async function main() {
  const kind = process.argv[2];
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const payload = raw.trim() ? JSON.parse(raw) : {};
    recordEvent(kind || (payload.hook_event_name === 'SubagentStop' ? 'stop' : 'start'), payload, process.env.CLAUDE_PROJECT_DIR || '.');
  } catch { /* a monitoring hook must never break the session */ }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
