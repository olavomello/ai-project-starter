// Tests for template/scripts/decisions.mjs (reading and approving pending decisions), the ai-dash endpoints
// and page that use it, and that the ai-dash mod's own copy of the parser agrees with it.
// Node's built-in test runner.
//
// Run: node --test cli/test/decisions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseItems, removeLine, buildPrompt, readDecisions, approveDecision, hashLine } from '../../template/scripts/decisions.mjs';
import * as modParse from '../../mods/ai-dash/hooks/lib/decisions-parse.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const AI_DASH = join(ROOT, 'template', 'scripts', 'ai-dash.mjs');
const FILE = 'docs/pending-decisions.md';
const SAMPLE = [
  '# Pending decisions',
  '',
  '## Needed before going live',
  '',
  '| Item | What is needed | Blocks |',
  '|---|---|---|',
  '| **Fly.io** | Create the account and `FLY_API_TOKEN` | API deploy |',
  '| Stripe | Keys, never in the [repo](https://x.test) | Real payments |',
  '',
  '## Decisions to take',
  '',
  '| Item | Question | Blocks |',
  '|---|---|---|',
  '| Admin role | Who is an admin? | Admin screens |',
  '',
  '```',
  '| not | an | item |',
  '- not a bullet either',
  '```',
  '',
  '## Notes',
  '',
  '- [ ] Rotate the salt',
  '- Plain bullet',
  '',
].join('\n');

const tmp = () => mkdtempSync(join(tmpdir(), 'decisions-'));
const done = (d) => rmSync(d, { recursive: true, force: true });
function project(text = SAMPLE) {
  const dir = tmp();
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, FILE), text);
  return dir;
}
const inboxOf = (dir) => {
  const p = join(dir, '.agents', 'state', 'decisions-inbox.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('the template parser and the mod\'s copy give identical answers', () => {
  assert.deepEqual(parseItems(SAMPLE), modParse.parseItems(SAMPLE));
  assert.deepEqual(parseItems(''), modParse.parseItems(''));
  const [first] = parseItems(SAMPLE);
  assert.equal(removeLine(SAMPLE, first.raw), modParse.removeLine(SAMPLE, first.raw));
  assert.equal(hashLine('| a | b |'), modParse.hashLine('| a | b |'));
  assert.deepEqual(parseItems(SAMPLE).map((i) => i.title), ['Fly.io', 'Stripe', 'Admin role', 'Rotate the salt', 'Plain bullet']);
  // the prompts differ only in where the approval happened
  assert.equal(buildPrompt(first, FILE), modParse.buildPrompt(first, FILE));
  assert.match(buildPrompt(first, FILE, 'AI Dash'), /through AI Dash/);
});

test('readDecisions lists items without their raw line, and says when the file is missing', () => {
  const dir = project();
  try {
    const d = readDecisions(dir);
    assert.equal(d.exists, true);
    assert.equal(d.items.length, 5);
    assert.ok(d.items.every((i) => !('raw' in i)), 'the raw markdown line is not sent to the page');
    assert.equal(d.queued, 0);
    assert.deepEqual(readDecisions(join(dir, 'nowhere')), { file: FILE, exists: false, items: [], queued: 0 });
  } finally { done(dir); }
});

test('approving removes the row and queues a prompt for the open session', () => {
  const dir = project();
  try {
    const stripe = readDecisions(dir).items.find((i) => i.title === 'Stripe');
    const r = approveDecision(dir, stripe.id, { now: 42 });
    assert.deepEqual(r, { ok: true, title: 'Stripe' });
    assert.ok(!readFileSync(join(dir, FILE), 'utf8').includes('| Stripe |'));
    assert.ok(readFileSync(join(dir, FILE), 'utf8').includes('| **Fly.io** |'));
    const [queued] = inboxOf(dir);
    assert.deepEqual([queued.ts, queued.id, queued.title], [42, stripe.id, 'Stripe']);
    assert.match(queued.prompt, /Item: Stripe/);
    assert.match(queued.prompt, /through AI Dash/);
    assert.match(queued.prompt, /already been removed from docs\/pending-decisions\.md/);
    assert.equal(readDecisions(dir).queued, 1);
  } finally { done(dir); }
});

test('approving an item that is gone, or a file that is missing, changes nothing', () => {
  const dir = project();
  try {
    const stripe = readDecisions(dir).items.find((i) => i.title === 'Stripe');
    assert.equal(approveDecision(dir, stripe.id).ok, true);
    const again = approveDecision(dir, stripe.id);
    assert.equal(again.ok, false);
    assert.match(again.error, /no longer in the file/);
    assert.equal(inboxOf(dir).length, 1, 'the second attempt queued nothing');
    assert.match(approveDecision(join(dir, 'nowhere'), 'abc').error, /not found/);
  } finally { done(dir); }
});

test('approving keeps the file\'s Windows line endings', () => {
  const dir = project(SAMPLE.replace(/\n/g, '\r\n'));
  try {
    const stripe = readDecisions(dir).items.find((i) => i.title === 'Stripe');
    assert.equal(approveDecision(dir, stripe.id).ok, true);
    const text = readFileSync(join(dir, FILE), 'utf8');
    assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'still CRLF throughout');
    assert.equal(readDecisions(dir).items.length, 4);
  } finally { done(dir); }
});

function request(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('the dashboard lists decisions and approves one only behind the write guard', async () => {
  const dir = project();
  const port = 4623;
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), 'x');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 'T'); git('add', '-A'); git('commit', '-q', '-m', 'init');
  const child = spawn(process.execPath, [AI_DASH, '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await request(port, 'GET', '/api/config')).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const list = JSON.parse((await request(port, 'GET', '/api/decisions')).text);
    assert.equal(list.exists, true);
    assert.equal(list.items.length, 5);
    assert.equal((await request(port, 'GET', '/api/decisions', { headers: { host: 'evil.example' } })).status, 400);

    const id = list.items.find((i) => i.title === 'Admin role').id;
    const json = { 'content-type': 'application/json', 'x-ai-dash': '1' };
    const post = (headers, body) => request(port, 'POST', '/api/decisions/approve', { headers, body });
    assert.equal((await request(port, 'GET', '/api/decisions/approve')).status, 405);
    assert.equal((await post({ 'content-type': 'application/json' }, JSON.stringify({ id }))).status, 400, 'needs the X-AI-Dash header');
    assert.equal((await post({ ...json, host: 'evil.example' }, JSON.stringify({ id }))).status, 400, 'needs a local Host');
    assert.equal((await post(json, JSON.stringify({ id, extra: 1 }))).status, 400, 'exactly one field');
    assert.equal((await post(json, JSON.stringify({ id: '../etc' }))).status, 400, 'ids are short alphanumerics');
    assert.equal((await post(json, '{ nope')).status, 400);
    assert.equal(readDecisions(dir).items.length, 5, 'nothing was approved by the refused requests');

    const ok = await post(json, JSON.stringify({ id }));
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.text).title, 'Admin role');
    assert.equal(readDecisions(dir).items.length, 4);
    assert.equal(inboxOf(dir).length, 1);
    const again = await post(json, JSON.stringify({ id }));
    assert.equal(again.status, 409, 'approving the same item twice is refused');
    assert.equal(inboxOf(dir).length, 1);
    assert.equal(JSON.parse((await request(port, 'GET', '/api/decisions')).text).queued, 1);
  } finally {
    child.kill();
    await exited;
    done(dir);
  }
});

// ---- the page ----
function loadPage(responses) {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('// Pending decisions: reads docs/pending-decisions.md');
  const end = html.indexOf('// Skills viewer: lists name + description');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const classes = new Set();
  const make = () => ({ hidden: false, innerHTML: '', textContent: '', scrollTop: 0, title: '', onclick: null, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } });
  const els = { 'decisions-btn': make(), 'decisions-count': make(), 'decisions-backdrop': make(), 'decisions-body': make(), 'decisions-sub': make(), 'decisions-close': make() };
  let clickHandler;
  els['decisions-body'].addEventListener = (type, fn) => { if (type === 'click') clickHandler = fn; };
  const calls = [];
  const ctx = {
    document: { hidden: false, getElementById: (id) => els[id], addEventListener() {} },
    fetch: async (url, init) => {
      calls.push([url, init && init.method]);
      const r = responses[url];
      return r ? { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.body } : { ok: false, status: 404, json: async () => ({}) };
    },
    esc, setInterval: () => 1, clearInterval() {}, JSON, String, Number, Promise,
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  const target = (attr, value) => ({ closest: (sel) => (sel === `[${attr}]` ? { dataset: { [attr.replace('data-', '')]: value } } : null) });
  return { els, calls, click: (attr, value) => clickHandler({ target: target(attr, value) }), open: () => els['decisions-btn'].onclick(), isOpen: () => classes.has('open') };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const DATA = { file: FILE, exists: true, queued: 0, items: [
  { id: 'a1', section: 'Needed before going live', group: 0, title: 'Fly.io', detail: 'Create the account', blocks: 'API deploy' },
  { id: 'b2', section: 'Needed before going live', group: 0, title: 'Stripe', detail: 'Keys', blocks: 'Payments' },
  { id: 'c3', section: 'Notes', group: 2, title: 'Rotate the salt', detail: '', blocks: '' },
] };

test('the icon stays hidden without the endpoint or the file, and shows the count with it', async () => {
  const none = loadPage({});
  await tick();
  assert.equal(none.els['decisions-btn'].hidden, true, 'static hosting: no endpoint');
  const missing = loadPage({ 'api/decisions': { body: { file: FILE, exists: false, items: [], queued: 0 } } });
  await tick();
  assert.equal(missing.els['decisions-btn'].hidden, true, 'no decisions file in this project');
  const page = loadPage({ 'api/decisions': { body: DATA } });
  await tick();
  assert.equal(page.els['decisions-btn'].hidden, false);
  assert.equal(page.els['decisions-count'].textContent, '3');
  assert.match(page.els['decisions-btn'].title, /Pending decisions: 3/);
});

test('the modal lists items by section and asks before approving; Cancel keeps everything', async () => {
  const page = loadPage({ 'api/decisions': { body: DATA } });
  await tick();
  page.open();
  await tick();
  const html = page.els['decisions-body'].innerHTML;
  assert.ok(page.isOpen());
  assert.ok(html.includes('Needed before going live') && html.includes('Fly.io') && html.includes('Blocks: API deploy'));
  assert.ok(html.includes('data-approve="a1"') && !html.includes('data-yes'));
  page.click('data-approve', 'a1');
  assert.ok(page.els['decisions-body'].innerHTML.includes('Send to the agent and remove from the file?'));
  assert.ok(page.els['decisions-body'].innerHTML.includes('data-yes="a1"'));
  page.click('data-no', '1');
  assert.ok(!page.els['decisions-body'].innerHTML.includes('data-yes'));
  assert.ok(!page.calls.some(([, method]) => method === 'POST'), 'nothing was sent');
});

test('confirming posts the id with the guard header, then the list refreshes with a notice', async () => {
  const responses = { 'api/decisions': { body: DATA }, 'api/decisions/approve': { body: { ok: true, title: 'Fly.io' } } };
  const page = loadPage(responses);
  await tick();
  page.open();
  await tick();
  page.click('data-approve', 'a1');
  responses['api/decisions'] = { body: { ...DATA, queued: 1, items: DATA.items.slice(1) } };
  page.click('data-yes', 'a1');
  await tick();
  assert.deepEqual(page.calls.filter(([, m]) => m === 'POST'), [['api/decisions/approve', 'POST']]);
  const html = page.els['decisions-body'].innerHTML;
  assert.ok(html.includes('Approved: Fly.io'));
  assert.ok(!html.includes('data-approve="a1"'));
  assert.ok(html.includes('1 approved item waiting for a Claude Code session'));
  assert.equal(page.els['decisions-count'].textContent, '2');
});

test('a refused approval shows the server\'s reason', async () => {
  const page = loadPage({ 'api/decisions': { body: DATA }, 'api/decisions/approve': { status: 409, body: { ok: false, error: 'that item changed on disk; the list was refreshed' } } });
  await tick();
  page.open();
  await tick();
  page.click('data-approve', 'a1');
  page.click('data-yes', 'a1');
  await tick();
  assert.ok(page.els['decisions-body'].innerHTML.includes('that item changed on disk'));
});
