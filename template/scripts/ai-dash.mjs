#!/usr/bin/env node
// Local server for ai-dash/, bound to 127.0.0.1 only. Serves the static
// files in <shared root>/ai-dash/ (same recommended way to view the
// dashboard as `npx serve ai-dash` — see ai-dash/README.md), plus two JSON
// endpoints the page's Settings area uses to read and toggle the optional
// ai-dash mod through scripts/mod.mjs — the one implementation of that
// toggle (see ADR on the session mod).
//
// Usage: node scripts/ai-dash.mjs [--port 4173]
//
// On static hosting (Vercel, a plain `npx serve`) these endpoints don't
// exist, and the page's Settings row falls back to showing the commands to
// run instead — see the GET /api/config contract in ai-dash/README.md.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { statusOf, enableMod, disableMod } from './mod.mjs';
import { listSkills, usageMap, NEVER } from './skills.mjs';
import { readLive, readActivity } from './agent-live.mjs';
import { field as fieldOf } from './agents-sync.mjs';
import { readDecisions, approveDecision, MAX_INSTRUCTIONS } from './decisions.mjs';

function repoRoot() {
  try {
    const gitCommonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (gitCommonDir) return dirname(gitCommonDir);
  } catch { /* not a git repo, or git missing */ }
  return process.cwd();
}

function mainWorkingTree() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || process.cwd();
  } catch { return process.cwd(); }
}

const ROOT = repoRoot();
const DASH_DIR = join(ROOT, 'ai-dash');
const TARGET_DIR = mainWorkingTree(); // where .claude/settings.json actually lives
const MAX_BODY = 1024; // 1 KiB

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i === -1) return 4173;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n <= 0) { console.error('ai-dash: --port needs a positive integer'); process.exit(1); }
  return n;
}
const PORT = parsePort(process.argv.slice(2));

function send(res, status, body, contentType) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

/** `Host`/`Origin` must name this exact server — stops another page from flipping the setting. */
function originOk(req, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = req.headers.host;
  if (!allowed.has(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const u = new URL(origin);
      if (!allowed.has(u.host)) return false;
    } catch { return false; }
  }
  return true;
}

/** Agents running right now (from the SubagentStart/SubagentStop hooks) plus recent runs and claims. */
async function handleGetLive(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  const live = readLive(TARGET_DIR);
  const roster = new Map();
  const agentsDir = join(TARGET_DIR, 'docs', 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.md') && !x.startsWith('_'))) {
      const text = readFileSync(join(agentsDir, f), 'utf8');
      roster.set(f.slice(0, -3), { description: fieldOf(text, 'Description'), owns: fieldOf(text, 'Owns') });
    }
  }
  const withInfo = (r) => ({ ...r, ...(roster.get(r.type) || {}) });
  res.setHeader('cache-control', 'no-store');
  sendJson(res, 200, { ...live, running: live.running.map(withInfo), recent: live.recent.map(withInfo) });
}

/** Hourly tool-call and run counters for the Activity chart (the page groups them by hour/day/week/month). */
async function handleGetActivity(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  res.setHeader('cache-control', 'no-store');
  sendJson(res, 200, { now: Date.now(), hours: readActivity(TARGET_DIR) });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the socket can still flush our response
      size += chunk.length;
      if (size > maxBytes) { tooLarge = true; reject(new Error('body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

async function handleGetConfig(req, res) {
  const status = statusOf(TARGET_DIR);
  sendJson(res, 200, { mod: { enabled: status.enabled, source: status.source, ref: status.ref } });
}

/** Names, descriptions, dates and validity of skills, functions and agents — never their bodies. */
async function handleGetSkills(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  const used = usageMap(TARGET_DIR);
  const agents = [];
  const agentsDir = join(TARGET_DIR, 'docs', 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.md') && !x.startsWith('_')).sort()) {
      const text = readFileSync(join(agentsDir, f), 'utf8');
      const field = (k) => (new RegExp(`^${k}\\s*:\\s*(.*)$`, 'mi').exec(text) || [, ''])[1].trim();
      const name = f.slice(0, -3);
      agents.push({ name, description: field('Description'), status: field('Status'), creationDate: field('Creation date'), createdBy: field('Created by'), lastUsage: used.get(`agent:${name}`) || NEVER });
    }
  }
  sendJson(res, 200, { skills: listSkills(TARGET_DIR), agents });
}

/**
 * Stops this server, so the ai-dash mod can restart it after an update (a running process keeps
 * the old code). Same guard as POST /api/config: a local Host and Origin, a JSON content type and the
 * X-AI-Dash header, which a web page cannot send cross-origin without a preflight.
 */
async function handlePostShutdown(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  if (req.headers['content-type'] !== 'application/json') return sendJson(res, 400, { error: 'expected application/json' });
  if (req.headers['x-ai-dash'] !== '1') return sendJson(res, 400, { error: 'missing X-AI-Dash header' });
  sendJson(res, 200, { stopping: true });
  setTimeout(() => process.exit(0), 50);
}

/** The pending decisions in docs/pending-decisions.md, read-only, for the dashboard's decisions viewer. */
async function handleGetDecisions(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  res.setHeader('cache-control', 'no-store');
  sendJson(res, 200, readDecisions(TARGET_DIR));
}

/**
 * Approves one pending decision: its row leaves the file and its prompt is queued for the open Claude Code
 * session (the ai-dash mod hands it over). Same guard as the other writes: a local Host and Origin, a JSON
 * content type and the X-AI-Dash header, plus a body of { "id": "<item id>" } and, optionally, the
 * Administrator's "instructions" for carrying the item out.
 */
async function handlePostApprove(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  if (req.headers['content-type'] !== 'application/json') return sendJson(res, 400, { error: 'expected application/json' });
  if (req.headers['x-ai-dash'] !== '1') return sendJson(res, 400, { error: 'missing X-AI-Dash header' });
  let text;
  try { text = await readBody(req, MAX_BODY); } catch { return sendJson(res, 400, { error: 'body too large' }); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
  const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
  const fine = keys.every((k) => k === 'id' || k === 'instructions')
    && typeof parsed.id === 'string' && /^[0-9a-z]{1,12}$/.test(parsed.id)
    && (parsed.instructions === undefined || (typeof parsed.instructions === 'string' && parsed.instructions.length <= MAX_INSTRUCTIONS));
  if (!fine) return sendJson(res, 400, { error: 'expected { "id": "<item id>", "instructions"?: "<text, up to 2000 characters>" }' });
  const result = approveDecision(TARGET_DIR, parsed.id, { instructions: parsed.instructions || '' });
  sendJson(res, result.ok ? 200 : 409, result);
}

async function handlePostConfig(req, res) {
  if (!originOk(req, PORT)) return sendJson(res, 400, { error: 'bad host or origin' });
  if (req.headers['content-type'] !== 'application/json') return sendJson(res, 400, { error: 'expected application/json' });
  if (req.headers['x-ai-dash'] !== '1') return sendJson(res, 400, { error: 'missing X-AI-Dash header' });

  let text;
  try { text = await readBody(req, MAX_BODY); } catch { return sendJson(res, 400, { error: 'body too large' }); }

  let parsed;
  try { parsed = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }

  const enabled = parsed?.mod?.enabled;
  const keys = Object.keys(parsed || {});
  if (keys.length !== 1 || keys[0] !== 'mod' || typeof enabled !== 'boolean'
      || Object.keys(parsed.mod).length !== 1) {
    return sendJson(res, 400, { error: 'expected exactly { "mod": { "enabled": true|false } }' });
  }

  try {
    const status = enabled ? enableMod(TARGET_DIR) : disableMod(TARGET_DIR);
    sendJson(res, 200, { mod: { enabled: status.enabled, source: status.source, ref: status.ref } });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const resolved = normalize(join(DASH_DIR, rel));
  // Reject path traversal: the resolved path must stay inside DASH_DIR.
  if (!resolved.startsWith(DASH_DIR)) return send(res, 400, 'bad path', 'text/plain');
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return send(res, 404, 'not found', 'text/plain');
  const type = CONTENT_TYPES[extname(resolved)] || 'application/octet-stream';
  send(res, 200, readFileSync(resolved), type);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/live' && req.method === 'GET') return await handleGetLive(req, res);
    if (url.pathname === '/api/activity' && req.method === 'GET') return await handleGetActivity(req, res);
    if (url.pathname === '/api/skills' && req.method === 'GET') return await handleGetSkills(req, res);
    if (url.pathname === '/api/config' && req.method === 'GET') return await handleGetConfig(req, res);
    if (url.pathname === '/api/decisions' && req.method === 'GET') return await handleGetDecisions(req, res);
    if (url.pathname === '/api/decisions/approve' && req.method === 'POST') return await handlePostApprove(req, res);
    if (url.pathname === '/api/decisions/approve') return send(res, 405, 'method not allowed', 'text/plain');
    if (url.pathname === '/api/config' && req.method === 'POST') return await handlePostConfig(req, res);
    if (url.pathname === '/api/shutdown' && req.method === 'POST') return await handlePostShutdown(req, res);
    if (url.pathname === '/api/shutdown') return send(res, 405, 'method not allowed', 'text/plain');
    if (url.pathname === '/api/config') return send(res, 405, 'method not allowed', 'text/plain');
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ai-dash: http://127.0.0.1:${PORT}`);
});
