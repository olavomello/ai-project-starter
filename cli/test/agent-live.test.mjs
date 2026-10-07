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
  const code = html.slice(html.indexOf('function setHtml('), html.indexOf('// Live agents:')) + html.slice(start, html.indexOf('})();', start) + 5);
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

// ---- main sessions (one run per turn) ----
test('a session turn is a run of type main, with its folder label and its own tool calls', () => {
  const dir = tmp();
  try {
    const cwd = join(dir, 'worktrees', 'init-assessment');
    recordEvent('session-start', { session_id: 'S1', cwd }, dir, T0);
    recordEvent('tool', { session_id: 'S1', tool_name: 'Bash', tool_input: { command: 'pnpm test' } }, dir, T0 + 1000);
    recordEvent('tool', { session_id: 'S1', agent_id: 'sub1', agent_type: 'dev-api-builder', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }, dir, T0 + 2000); // a subagent's call, not the session's
    const live = readLive(dir, { now: T0 + 5000 });
    assert.equal(live.running.length, 1);
    assert.deepEqual([live.running[0].type, live.running[0].label], ['main', 'init-assessment']);
    assert.deepEqual(live.running[0].activity.map((a) => a.target), ['pnpm test']);
    recordEvent('session-stop', { session_id: 'S1' }, dir, T0 + 9000);
    const after = readLive(dir, { now: T0 + 10_000 });
    assert.equal(after.running.length, 0);
    assert.deepEqual([after.recent[0].type, after.recent[0].seconds], ['main', 9]);
  } finally { done(dir); }
});

test('a new turn closes a previous one that never got its Stop (an interrupt)', () => {
  const dir = tmp();
  try {
    recordEvent('session-start', { session_id: 'S1', cwd: dir }, dir, T0);
    recordEvent('tool', { session_id: 'S1', tool_name: 'Read', tool_input: { file_path: 'x' } }, dir, T0 + 1000);
    recordEvent('session-start', { session_id: 'S1', cwd: dir }, dir, T0 + 60_000);
    const live = readLive(dir, { now: T0 + 61_000 });
    assert.equal(live.running.length, 1);
    assert.equal(live.running[0].since, T0 + 60_000);
    assert.equal(live.recent.length, 1);
    assert.equal(live.recent[0].seconds, 60);
  } finally { done(dir); }
});

test('an idle main session expires after ten minutes, a busy one does not', () => {
  const dir = tmp();
  try {
    recordEvent('session-start', { session_id: 'S1', cwd: dir }, dir, T0);
    assert.equal(readLive(dir, { now: T0 + 9 * 60_000 }).running.length, 1);
    assert.equal(readLive(dir, { now: T0 + 11 * 60_000 }).running.length, 0);
    recordEvent('tool', { session_id: 'S1', tool_name: 'Bash', tool_input: { command: 'x' } }, dir, T0 + 10 * 60_000);
    assert.equal(readLive(dir, { now: T0 + 11 * 60_000 }).running.length, 1, 'recent tool activity keeps it alive');
  } finally { done(dir); }
});

test('subagent start/stop without an agent id are still ignored; session events need a session id', () => {
  const dir = tmp();
  try {
    assert.equal(recordEvent('start', { session_id: 'S1' }, dir, T0), false);
    assert.equal(recordEvent('session-start', {}, dir, T0), false);
    assert.equal(recordEvent('tool', { tool_name: 'Edit' }, dir, T0), false);
  } finally { done(dir); }
});

test('the hook script records session turns from UserPromptSubmit and Stop payloads', () => {
  const dir = tmp();
  try {
    const run = (arg, payload) => spawnSync(process.execPath, [LIVE_MJS, arg], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(run('session-start', { hook_event_name: 'UserPromptSubmit', session_id: 'S9', cwd: join(dir, 'wt-one'), prompt: 'secret prompt text' }).status, 0);
    const raw = readFileSync(join(dir, '.agents', 'log', 'live.jsonl'), 'utf8');
    assert.ok(!raw.includes('secret prompt text'), 'the prompt is never stored');
    const line = JSON.parse(raw.trim());
    assert.deepEqual([line.event, line.id, line.type, line.label], ['start', 's:S9', 'main', 'wt-one']);
    assert.equal(run('session-stop', { hook_event_name: 'Stop', session_id: 'S9', last_assistant_message: 'private answer' }).status, 0);
    assert.ok(!readFileSync(join(dir, '.agents', 'log', 'live.jsonl'), 'utf8').includes('private answer'));
  } finally { done(dir); }
});

test('the template wires the turn hooks', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, 'template', '.claude', 'settings.json'), 'utf8'));
  const cmd = (event) => settings.hooks[event].flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmd('UserPromptSubmit').some((c) => c.endsWith('agent-live.mjs session-start')));
  assert.ok(cmd('Stop').some((c) => c.endsWith('agent-live.mjs session-stop')));
  assert.ok(cmd('StopFailure').some((c) => c.endsWith('agent-live.mjs session-stop')));
});

test('the page names a main session by its folder', async () => {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('// Live agents:');
  const code = html.slice(html.indexOf('function setHtml('), html.indexOf('// Live agents:')) + html.slice(start, html.indexOf('})();', start) + 5);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const payload = { now: 1, claims: [], recent: [], running: [{ id: 's:S1', type: 'main', label: 'init-execution-assessment-70b48b', since: 0, seconds: 5, activity: [{ t: 1, tool: 'Bash', target: 'pnpm test' }] }] };
  const el = { hidden: true, innerHTML: '', addEventListener() {}, querySelectorAll: () => [] };
  vm.runInNewContext(code, {
    document: { hidden: false, activeElement: null, getElementById: () => el, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => payload }),
    esc, setInterval: () => 1, clearInterval() {}, Date, Number, String, Math, Set, Map,
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(el.innerHTML.includes('Main session · init-execution-assessment-70b48b'));
  assert.ok(el.innerHTML.includes('Bash pnpm test'));
});

// ---- activity chart data ----
import { tallyEvents, readActivity } from '../../template/scripts/agent-live.mjs';

test('tallyEvents counts session vs subagent tool calls and runs per UTC hour', () => {
  const H = 3600 * 1000, base = Math.floor(T0 / H) * H;
  const out = tallyEvents([
    { t: base + 5, id: 's:S1', event: 'tool' }, { t: base + 9, id: 's:S1', event: 'tool' },
    { t: base + 10, id: 'a1', event: 'tool' }, { t: base + 11, id: 'a1', event: 'start' }, { t: base + 12, id: 'a1', event: 'stop' },
    { t: base + H + 1, id: 's:S1', event: 'start' },
  ]);
  assert.deepEqual(out[String(base)], { main: 2, sub: 1, runs: 1 });
  assert.deepEqual(out[String(base + H)], { main: 0, sub: 0, runs: 1 });
});

test('trimming the raw log rolls the dropped lines into hourly counters without losing any', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, '.agents', 'log'), { recursive: true });
    const pad = 'x'.repeat(220);
    const lines = [];
    for (let i = 0; i < 4800; i++) lines.push(JSON.stringify({ t: T0 + i * 1000, event: 'tool', id: i % 2 ? 's:S1' : 'a1', type: 't', session: 'S1', tool: 'Edit', target: pad }));
    writeFileSync(join(dir, '.agents', 'log', 'live.jsonl'), lines.join('\n') + '\n'); // > 1 MB
    recordEvent('tool', { session_id: 'S1', tool_name: 'Edit', tool_input: { file_path: 'last.ts' } }, dir, T0 + 5_000_000);
    const raw = readFileSync(join(dir, '.agents', 'log', 'live.jsonl'), 'utf8').trim().split('\n');
    assert.ok(raw.length <= 3000 && raw.length > 100, `raw log kept ${raw.length} lines`);
    assert.ok(existsSync(join(dir, '.agents', 'log', 'activity.json')));
    const total = readActivity(dir).reduce((s, b) => s + b.main + b.sub, 0);
    assert.equal(total, 4801, 'rolled-up plus raw counts equal everything that was recorded');
  } finally { done(dir); }
});

test('GET /api/activity serves the hourly counters and enforces Host', async () => {
  const dir = tmp();
  const port = 4621;
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), 'x');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  recordEvent('tool', { session_id: 'S1', tool_name: 'Edit', tool_input: {} }, dir, Date.now());
  recordEvent('tool', { agent_id: 'a1', agent_type: 'x', tool_name: 'Edit', tool_input: {} }, dir, Date.now());
  const child = spawn(process.execPath, [AI_DASH_MJS, '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await get(port, '/api/config')).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await get(port, '/api/activity');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.hours.reduce((s, b) => s + b.main, 0), 1);
    assert.equal(body.hours.reduce((s, b) => s + b.sub, 0), 1);
    assert.equal((await get(port, '/api/activity', 'evil.example')).status, 400);
  } finally { await stopChild(child); done(dir); }
});

async function runActivityPage(rows) {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('// Activity chart:');
  const code = html.slice(html.indexOf('function setHtml('), html.indexOf('// Live agents:')) + html.slice(start, html.indexOf('})();', start) + 5);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let click;
  const stored = {};
  const el = { hidden: true, innerHTML: '', addEventListener: (t, fn) => { if (t === 'click') click = fn; }, querySelectorAll: () => [] };
  vm.runInNewContext(code, {
    document: { hidden: false, getElementById: () => el, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => ({ hours: rows }) }),
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } },
    esc, wireTips() {}, setInterval: () => 1, clearInterval() {}, Date, Number, Math, Map, String, Intl,
  });
  await new Promise((r) => setTimeout(r, 50));
  const pick = (range) => click({ target: { closest: () => ({ dataset: { range } }) } });
  const calls = () => Number((/<b>([\d,.\u00a0\u202f ]+)<\/b>tool calls/.exec(el.innerHTML) || [, 'NaN'])[1].replace(/\D/g, ''));
  return { el, pick, calls, stored };
}

test('the Activity card filters by hour, day, week and month, and remembers the choice', async () => {
  const H = 3600 * 1000, now = Date.now();
  const row = (ago, main, sub, runs = 1) => ({ h: Math.floor((now - ago) / H) * H, main, sub, runs });
  const { el, pick, calls, stored } = await runActivityPage([
    row(1 * H, 10, 5),           // inside every range
    row(30 * H, 7, 0),           // older than 24 hours, inside 14 days
    row(20 * 24 * H, 100, 0),    // older than 14 days, inside 12 weeks / 12 months
    row(400 * 24 * H, 1000, 0),  // older than a year: in none
  ]);
  assert.equal(el.hidden, false);
  assert.ok(el.innerHTML.includes('data-range="hour"') && el.innerHTML.includes('data-range="month"'));
  assert.equal(calls(), 22, 'day (14 days)');
  pick('hour'); assert.equal(calls(), 15, 'hour (24 hours)');
  pick('week'); assert.equal(calls(), 122, 'week (12 weeks)');
  pick('month'); assert.equal(calls(), 122, 'month (12 months)');
  assert.equal(stored['ai-dash-activity-range'], 'month');
  assert.ok(el.innerHTML.includes('aria-pressed="true">Month'));
  assert.ok(el.innerHTML.includes('data-tip='));
});

test('the Activity card shows an empty message instead of a blank chart', async () => {
  const { el, pick } = await runActivityPage([]);
  assert.ok(el.innerHTML.includes('No activity in the last 14 days'));
  pick('hour');
  assert.ok(el.innerHTML.includes('No activity in the last 24 hours'));
  assert.ok(!el.innerHTML.includes('<svg'));
});
