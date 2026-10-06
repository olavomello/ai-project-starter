// Tests for template/scripts/agent-live.mjs (SubagentStart/Stop log -> "running
// now"), its GET /api/live endpoint in ai-dash, and the hook wiring. Node's
// built-in test runner.
//
// Run: node --test cli/test/agent-live.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordEvent, readLive, STALE_MS } from '../../template/scripts/agent-live.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LIVE_MJS = join(ROOT, 'template', 'scripts', 'agent-live.mjs');
const AI_DASH_MJS = join(ROOT, 'template', 'scripts', 'ai-dash.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'agent-live-'));
const done = (dir) => rmSync(dir, { recursive: true, force: true });
const T0 = 1_800_000_000_000;

test('start and stop events become running and recent runs', () => {
  const dir = tmp();
  try {
    recordEvent('start', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, T0);
    recordEvent('start', { agent_id: 'a2', agent_type: 'tst-app-tester' }, dir, T0 + 5_000);
    recordEvent('stop', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, T0 + 65_000);
    const live = readLive(dir, { now: T0 + 70_000 });
    assert.deepEqual(live.running.map((r) => [r.type, r.seconds]), [['tst-app-tester', 65]]);
    assert.deepEqual(live.recent.map((r) => [r.type, r.seconds]), [['dev-web-builder', 65]]);
  } finally { done(dir); }
});

test('a start with no stop goes stale instead of showing as running forever', () => {
  const dir = tmp();
  try {
    recordEvent('start', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, T0);
    assert.equal(readLive(dir, { now: T0 + STALE_MS - 1 }).running.length, 1);
    assert.equal(readLive(dir, { now: T0 + STALE_MS + 1 }).running.length, 0);
  } finally { done(dir); }
});

test('events without an agent_id (the main thread) are ignored; bad kinds throw', () => {
  const dir = tmp();
  try {
    assert.equal(recordEvent('start', { agent_type: 'x' }, dir, T0), false);
    assert.throws(() => recordEvent('pause', { agent_id: 'a' }, dir, T0));
    assert.deepEqual(readLive(dir, { now: T0 }).running, []);
  } finally { done(dir); }
});

test('torn lines are skipped and recent is newest first and capped', () => {
  const dir = tmp();
  try {
    for (let i = 0; i < 5; i++) {
      recordEvent('start', { agent_id: `a${i}`, agent_type: 't' }, dir, T0 + i * 1000);
      recordEvent('stop', { agent_id: `a${i}`, agent_type: 't' }, dir, T0 + i * 1000 + 500);
    }
    writeFileSync(join(dir, '.agents', 'log', 'live.jsonl'), '{"torn":\n', { flag: 'a' });
    const live = readLive(dir, { now: T0 + 10_000, recent: 3 });
    assert.deepEqual(live.recent.map((r) => r.id), ['a4', 'a3', 'a2']);
  } finally { done(dir); }
});

test('claims from agent-team.sh are included', () => {
  const dir = tmp();
  try {
    const lock = join(dir, '.agents', 'locks', 'dev-web-builder');
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'holder'), 'Main\n');
    writeFileSync(join(lock, 'since'), '2026-10-06T10:00:00Z\n');
    writeFileSync(join(lock, 'globs'), 'web/**\nui/**\n');
    const { claims } = readLive(dir, { now: T0 });
    assert.deepEqual(claims, [{ name: 'dev-web-builder', holder: 'Main', since: '2026-10-06T10:00:00Z', globs: ['web/**', 'ui/**'] }]);
  } finally { done(dir); }
});

test('the hook script logs from stdin, exits 0 on garbage, and logs to CLAUDE_PROJECT_DIR', () => {
  const dir = tmp();
  try {
    const run = (arg, input) => spawnSync(process.execPath, [LIVE_MJS, arg], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    const ok = run('start', JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'abc', agent_type: 'dev-api-builder', session_id: 's1' }));
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(run('start', 'not json').status, 0);
    assert.equal(run('stop', '').status, 0);
    const lines = readFileSync(join(dir, '.agents', 'log', 'live.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].event, lines[0].id, lines[0].type], ['start', 'abc', 'dev-api-builder']);
    assert.deepEqual(Object.keys(lines[0]).sort(), ['event', 'id', 'session', 't', 'type']);
  } finally { done(dir); }
});

function get(port, path, host) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { host: host || `127.0.0.1:${port}` } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function stopChild(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  }
}

test('GET /api/live serves running agents with roster details and enforces Host', async () => {
  const dir = tmp();
  const port = 4620;
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), 'x');
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'agents', 'dev-web-builder.md'),
    '## CONFIGS\nName : dev-web-builder\nDescription : Builds the web UI\nStatus : ON\nOwns : web/**\n\n## SCOPE AND RULES\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  recordEvent('start', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, Date.now() - 12_000);
  const child = spawn(process.execPath, [AI_DASH_MJS, '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await get(port, '/api/config')).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await get(port, '/api/live');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.running.length, 1);
    assert.equal(body.running[0].type, 'dev-web-builder');
    assert.equal(body.running[0].description, 'Builds the web UI');
    assert.equal(body.running[0].owns, 'web/**');
    assert.ok(body.running[0].seconds >= 12);
    assert.equal((await get(port, '/api/live', 'evil.example')).status, 400);
  } finally { await stopChild(child); done(dir); }
});

test('the template wires both subagent hooks and the dashboard has the Live panel', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, 'template', '.claude', 'settings.json'), 'utf8'));
  for (const [event, arg] of [['SubagentStart', 'start'], ['SubagentStop', 'stop']]) {
    const commands = settings.hooks[event].flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(commands.some((c) => c.includes('scripts/agent-live.mjs') && c.endsWith(` ${arg}`)), event);
  }
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  assert.ok(html.includes('id="live"') && html.includes("'api/live'"));
  assert.ok(existsSync(join(ROOT, 'template', 'scripts', 'agent-live.mjs')));
});

// ---- tool activity (the per-agent monitor) ----
import vm from 'node:vm';
import { summarizeTool, mask } from '../../template/scripts/agent-live.mjs';

test('summarizeTool gives a short, project-relative, masked target', () => {
  const bs = String.fromCharCode(92); // Windows separator
  assert.equal(summarizeTool({ file_path: ['D:', 'work', 'proj', 'apps', 'web', 'page.tsx'].join(bs) }, 'D:/work/proj'), 'apps/web/page.tsx');
  assert.equal(summarizeTool({ command: 'pnpm   test  --filter web' }), 'pnpm test --filter web');
  assert.equal(summarizeTool({ pattern: 'TODO' }), 'TODO');
  assert.equal(summarizeTool({ url: 'https://example.com/a?token=abc' }), 'example.com');
  assert.equal(summarizeTool({}), '');
  const long = summarizeTool({ command: 'echo ' + 'x '.repeat(200) });
  assert.ok(long.length <= 160 && long.endsWith('\u2026'));
});

test('mask hides credentials in commands', () => {
  const hidden = mask('curl -H "Authorization: Bearer abc.def.ghi" https://x');
  assert.ok(!hidden.includes('abc.def.ghi') && hidden.includes('https://x'), hidden);
  assert.ok(!mask('API_KEY=sk_live_1234567890 node run').includes('sk_live'));
  assert.ok(!mask('echo ' + 'a'.repeat(40)).includes('aaaa'));
  assert.equal(mask('git status'), 'git status');
});

test('tool events attach to their run as activity, newest last and capped', () => {
  const dir = tmp();
  try {
    recordEvent('start', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, T0);
    for (let i = 0; i < 40; i++) {
      recordEvent('tool', { agent_id: 'a1', agent_type: 'dev-web-builder', tool_name: 'Edit', tool_input: { file_path: `f${i}.ts` } }, dir, T0 + 1000 + i);
    }
    recordEvent('tool', { tool_name: 'Edit', tool_input: { file_path: 'main-thread.ts' } }, dir, T0 + 5000); // no agent_id: ignored
    const live = readLive(dir, { now: T0 + 10_000 });
    const act = live.running[0].activity;
    assert.equal(act.length, 30);
    assert.deepEqual([act[0].target, act[29].target], ['f10.ts', 'f39.ts']);
    assert.ok(!JSON.stringify(live).includes('main-thread'));
    recordEvent('stop', { agent_id: 'a1', agent_type: 'dev-web-builder' }, dir, T0 + 20_000);
    assert.equal(readLive(dir, { now: T0 + 30_000 }).recent[0].activity.length, 8);
  } finally { done(dir); }
});

test('the hook script records a tool call from stdin', () => {
  const dir = tmp();
  try {
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', agent_id: 'abc', agent_type: 'tst-app-tester', tool_name: 'Bash', tool_input: { command: 'pnpm test' }, cwd: dir });
    const r = spawnSync(process.execPath, [LIVE_MJS, 'tool'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    const line = JSON.parse(readFileSync(join(dir, '.agents', 'log', 'live.jsonl'), 'utf8').trim());
    assert.deepEqual([line.event, line.tool, line.target], ['tool', 'Bash', 'pnpm test']);
  } finally { done(dir); }
});

test('the template runs the tool hook for every PreToolUse and keeps the existing guards', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, 'template', '.claude', 'settings.json'), 'utf8'));
  const pre = settings.hooks.PreToolUse;
  const all = pre.flatMap((g) => g.hooks.map((h) => ({ matcher: g.matcher, command: h.command })));
  assert.ok(all.some((h) => h.matcher === undefined && h.command.includes('agent-live.mjs') && h.command.endsWith(' tool')));
  assert.ok(all.some((h) => h.matcher === 'Bash' && h.command.includes('block-force-push.sh')));
  assert.ok(all.some((h) => h.matcher === 'Edit|Write' && h.command.includes('protect-version.sh')));
});

test('the page code: a monitor button opens the agent activity and survives the next poll', async () => {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('// Live agents:');
  const code = html.slice(start, html.indexOf('})();', start) + 5);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const payload = {
    now: 1, claims: [], recent: [],
    running: [{ id: 'r1', type: 'dev-web-builder', since: 0, seconds: 42, description: 'Builds the UI', activity: [{ t: 1_800_000_000_000, tool: 'Edit', target: 'apps/web/page.tsx' }] }],
  };
  let click;
  const el = { hidden: true, innerHTML: '', addEventListener: (type, fn) => { if (type === 'click') click = fn; }, querySelectorAll: () => [] };
  const ctx = {
    document: { hidden: false, activeElement: null, getElementById: () => el, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => payload }),
    esc, setInterval: () => 1, clearInterval() {}, Date, Number, String, Math, Set, Map,
  };
  vm.runInNewContext(code, ctx);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(el.innerHTML.includes('data-mon-toggle="r1"'));
  assert.ok(el.innerHTML.includes('Edit apps/web/page.tsx'), 'collapsed row shows what it is doing now');
  assert.ok(!el.innerHTML.includes('live-mon'), 'monitor starts closed');
  click({ target: { closest: () => ({ dataset: { monToggle: 'r1' } }) } });
  assert.ok(el.innerHTML.includes('live-mon') && el.innerHTML.includes('mon-tool'));
  assert.ok(el.innerHTML.includes('aria-expanded="true"'));
  click({ target: { closest: () => ({ dataset: { monToggle: 'r1' } }) } });
  assert.ok(!el.innerHTML.includes('live-mon'));
});
