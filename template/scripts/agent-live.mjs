#!/usr/bin/env node
// Live agent activity for ai-dash.
//
// Claude Code fires `SubagentStart` / `SubagentStop` around every subagent run,
// and `UserPromptSubmit` / `Stop` around every turn of a session. `.claude/settings.json`
// points them at this script, which appends one line per event to the local,
// git-ignored `.agents/log/live.jsonl` (shared by every worktree, like the usage log).
// `readLive` turns that log into "running now" and "recently finished", which
// `scripts/ai-dash.mjs` serves as `GET /api/live` for the dashboard's Live panel.
//
// A `PreToolUse` hook also records each tool call (`tool`), so the dashboard can
// show what an agent is doing. A tool event holds the tool name and a short, masked
// target (a project-relative file path, the first part of a command, a search
// pattern) — never prompts or tool output. The log is local and git-ignored, and
// only ever served to 127.0.0.1.
//
// The main conversation of a session has no agent id; it is tracked as "main"
// under the session id, one run per turn. Claude Code does not fire `Stop` when
// you interrupt a turn, so a run with no activity for a while counts as gone.
//
// Usage (as a hook; reads the hook's JSON from stdin, always exits 0):
//   node scripts/agent-live.mjs start | stop            (SubagentStart / SubagentStop)
//   node scripts/agent-live.mjs session-start | session-stop   (UserPromptSubmit / Stop, StopFailure)
//   node scripts/agent-live.mjs tool                    (PreToolUse)
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usageRoot } from './skills.mjs';

export const LIVE_LOG = join('.agents', 'log', 'live.jsonl');
const MAX_BYTES = 1024 * 1024; // past this, keep only the newest lines
const KEEP_LINES = 3000;
const TARGET_MAX = 160;
const ACTIVITY_RUNNING = 30; // tool events returned per running agent
const ACTIVITY_RECENT = 8; // ... per finished run
export const STALE_MS = 30 * 60 * 1000; // a subagent with no activity for this long is treated as gone
export const SESSION_IDLE_MS = 10 * 60 * 1000; // same for a main session (Stop doesn't fire on interrupt)

const logFile = (dir) => join(usageRoot(dir), LIVE_LOG);
const isSessionId = (id) => id.startsWith('s:');

const SECRET_PAIR = /(token|secret|password|passwd|api[_-]?key|authorization|auth)(\s*[=:]\s*|\s+)\S+/gi;
const BEARER = /bearer\s+\S+/gi;
const LONG_BLOB = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

/** Masks anything that looks like a credential before a command or path is stored. */
export function mask(text) {
  // Bearer first: "Authorization: Bearer abc" must not leave `abc` behind after the pair rule eats "Bearer".
  return String(text).replace(BEARER, 'Bearer ***').replace(SECRET_PAIR, '$1=***').replace(LONG_BLOB, '***');
}

/** A short, masked "what is it touching" for one tool call; '' when nothing useful. */
export function summarizeTool(input = {}, projectDir = '') {
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const rel = (p) => {
    const s = norm(p);
    const base = norm(projectDir).replace(/\/$/, '');
    return base && s.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? s.slice(base.length + 1) : s;
  };
  let target = '';
  if (input.file_path || input.notebook_path || input.path) target = rel(input.file_path || input.notebook_path || input.path);
  else if (typeof input.command === 'string') target = input.command.replace(/\s+/g, ' ').trim();
  else if (typeof input.pattern === 'string') target = input.pattern;
  else if (typeof input.query === 'string') target = input.query;
  else if (typeof input.description === 'string') target = input.description;
  else if (typeof input.url === 'string') { try { target = new URL(input.url).hostname; } catch { target = ''; } }
  target = mask(target);
  return target.length > TARGET_MAX ? `${target.slice(0, TARGET_MAX - 1)}…` : target;
}

const KINDS = ['start', 'stop', 'tool', 'session-start', 'session-stop'];

/** Appends one event. `payload` is the hook's stdin JSON. Returns false when there is nothing to track. */
export function recordEvent(kind, payload, dir = '.', now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error(`unknown event "${kind}"`);
  const session = String(payload?.session_id || '').slice(0, 64);
  let id = String(payload?.agent_id || '');
  // A tool call or turn event without an agent id is the session's main conversation.
  if (!id && session && (kind === 'tool' || kind.startsWith('session-'))) id = `s:${session}`;
  if (!id) return false;
  if ((kind === 'start' || kind === 'stop') && isSessionId(id)) return false;
  const file = logFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  const entry = {
    t: now,
    event: kind === 'session-start' ? 'start' : kind === 'session-stop' ? 'stop' : kind,
    id,
    type: isSessionId(id) ? 'main' : String(payload.agent_type || 'unknown').slice(0, 80),
    session,
  };
  if (kind === 'session-start') entry.label = basename(String(payload.cwd || dir).replace(/[\\/]+$/, '')).slice(0, 80);
  if (kind === 'tool') {
    entry.tool = String(payload.tool_name || 'tool').slice(0, 60);
    entry.target = summarizeTool(payload.tool_input, payload.cwd || dir);
  }
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  try {
    if (statSync(file).size > MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, `${lines.slice(-KEEP_LINES).join('\n')}\n`);
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
      if (e && typeof e.t === 'number' && e.id && (e.event === 'start' || e.event === 'stop' || e.event === 'tool')) events.push(e);
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
 * `running`: started, no stop yet, and active within the idle window (30 min for a
 * subagent, 10 min for a main session). A main session has one run per turn: a new
 * turn closes a previous one that never saw its `Stop` (an interrupt).
 * `recent`: finished runs, newest first, at most `recent` of them.
 * Each run carries its latest tool calls as `activity` (oldest first).
 */
export function readLive(dir = '.', { now = Date.now(), staleMs = STALE_MS, idleMs = SESSION_IDLE_MS, recent = 12 } = {}) {
  const runs = [];
  const current = new Map(); // id -> the run tool events attach to
  for (const e of readEvents(dir)) {
    let r = current.get(e.id);
    if (e.event === 'start') {
      if (r && r.stopped === null && isSessionId(e.id)) r.stopped = e.t; // previous turn was interrupted
      if (!r || r.stopped !== null || isSessionId(e.id)) {
        r = { id: e.id, type: e.type, label: e.label || '', started: e.t, stopped: null, lastSeen: e.t, tools: [] };
        runs.push(r); current.set(e.id, r);
      } else { r.type = e.type; r.lastSeen = Math.max(r.lastSeen, e.t); }
    } else if (e.event === 'stop') {
      if (!r) { r = { id: e.id, type: e.type, label: '', started: e.t, stopped: e.t, lastSeen: e.t, tools: [] }; runs.push(r); current.set(e.id, r); }
      else if (r.stopped === null) { r.stopped = e.t; r.lastSeen = e.t; }
    } else if (r && r.stopped === null) { // tool
      r.tools.push({ t: e.t, tool: String(e.tool || 'tool'), target: String(e.target || '') });
      r.lastSeen = Math.max(r.lastSeen, e.t);
    }
  }
  const window = (r) => (isSessionId(r.id) ? idleMs : staleMs);
  const running = runs
    .filter((r) => r.stopped === null && now - r.lastSeen < window(r))
    .sort((a, b) => a.started - b.started)
    .map((r) => ({
      id: r.id, type: r.type, label: r.label, since: r.started, seconds: Math.max(0, Math.round((now - r.started) / 1000)),
      activity: r.tools.slice(-ACTIVITY_RUNNING),
    }));
  const finished = runs
    .filter((r) => r.stopped !== null)
    .sort((a, b) => b.stopped - a.stopped)
    .slice(0, recent)
    .map((r) => ({
      id: r.id, type: r.type, label: r.label, started: r.started, stopped: r.stopped, seconds: Math.max(0, Math.round((r.stopped - r.started) / 1000)),
      activity: r.tools.slice(-ACTIVITY_RECENT),
    }));
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
