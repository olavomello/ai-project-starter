// Tests for template/scripts/ais-update.mjs (the update checker behind the mod's "Update available"
// button) and the dashboard's shutdown endpoint the mod uses to restart it. Node's built-in runner.
//
// Run: node --test cli/test/ais-update.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkUpdate, remoteHead, updateCommand, applyUpdate, CACHE_MS } from '../../template/scripts/ais-update.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'template', 'scripts', 'ais-update.mjs');
const AI_DASH = join(ROOT, 'template', 'scripts', 'ai-dash.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'ais-update-'));
const done = (d) => rmSync(d, { recursive: true, force: true });
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const projectWith = (dir, starterRef) => writeFileSync(join(dir, '.ai-project-starter.json'), JSON.stringify({ starterRef }));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** A git repo with one commit, standing in for the starter's GitHub repo. */
function makeRemote(dir) {
  const repo = join(dir, 'remote');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@e.com');
  git(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'f'), '1');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  return repo;
}
function commitAgain(repo) {
  writeFileSync(join(repo, 'f'), String(Math.random()));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'next');
}

test('available only when the remote commit differs from the recorded one', () => {
  const dir = tmp();
  try {
    projectWith(dir, SHA_A);
    const r = checkUpdate(dir, { lookup: () => SHA_B });
    assert.deepEqual([r.available, r.current, r.latest], [true, 'aaaaaaa', 'bbbbbbb']);
    assert.equal(checkUpdate(dir, { force: true, lookup: () => SHA_A }).available, false);
    projectWith(dir, SHA_A.slice(0, 12)); // a manifest may hold a shortened sha
    assert.equal(checkUpdate(dir, { force: true, lookup: () => SHA_A }).available, false);
  } finally { done(dir); }
});

test('a fresh answer is cached for 30 minutes; force and age bypass it', () => {
  const dir = tmp();
  try {
    projectWith(dir, SHA_A);
    let calls = 0;
    const lookup = () => { calls++; return SHA_B; };
    const t0 = 1_800_000_000_000;
    checkUpdate(dir, { now: t0, lookup });
    checkUpdate(dir, { now: t0 + CACHE_MS - 1, lookup });
    assert.equal(calls, 1);
    checkUpdate(dir, { now: t0 + CACHE_MS + 1, lookup });
    assert.equal(calls, 2);
    checkUpdate(dir, { now: t0 + CACHE_MS + 2, force: true, lookup });
    assert.equal(calls, 3);
    assert.ok(existsSync(join(dir, '.agents', 'state', 'update-check.json')));
  } finally { done(dir); }
});

test('a failed lookup is reported, never thrown, and a stale answer still counts', () => {
  const dir = tmp();
  try {
    projectWith(dir, SHA_A);
    const down = () => { throw new Error('network is down\nsecond line'); };
    const first = checkUpdate(dir, { lookup: down });
    assert.deepEqual([first.available, first.latest, first.error], [false, null, 'network is down']);
    checkUpdate(dir, { now: 1000, lookup: () => SHA_B });
    const stale = checkUpdate(dir, { now: 1000 + CACHE_MS + 1, lookup: down });
    assert.deepEqual([stale.available, stale.latest, stale.error], [true, 'bbbbbbb', 'network is down']);
  } finally { done(dir); }
});

test('a project without a manifest cannot be compared and says why', () => {
  const dir = tmp();
  try {
    const r = checkUpdate(dir, { lookup: () => SHA_B });
    assert.equal(r.available, false);
    assert.match(r.error, /ai-project-starter adopt/);
  } finally { done(dir); }
});

test('remoteHead reads a real git remote, and rejects a missing branch', () => {
  const dir = tmp();
  try {
    const repo = makeRemote(dir);
    assert.equal(remoteHead(repo, 'main'), git(repo, 'rev-parse', 'HEAD'));
    assert.throws(() => remoteHead(repo, 'nope'), /no nope branch/);
  } finally { done(dir); }
});

test('the CLI prints JSON, and a project that is behind says so (against a real local remote)', () => {
  const dir = tmp();
  try {
    const repo = makeRemote(dir);
    const proj = join(dir, 'proj');
    mkdirSync(proj);
    projectWith(proj, git(repo, 'rev-parse', 'HEAD'));
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, AIS_REPO: repo } });
    assert.equal(JSON.parse(run('check', '--json').stdout).available, false);
    commitAgain(repo);
    assert.equal(JSON.parse(run('check', '--json').stdout).available, false, 'the cached answer is reused');
    assert.equal(JSON.parse(run('check', '--force', '--json').stdout).available, true);
    assert.match(run('check', '--force').stdout, /update available: .* -> /);
  } finally { done(dir); }
});

test('updateCommand uses npx from GitHub, and AIS_UPDATE_CMD overrides it', () => {
  assert.deepEqual(updateCommand({}, 'linux'), ['npx', '--yes', 'github:olavomello/ai-project-starter#main', 'update']);
  assert.equal(updateCommand({}, 'win32')[0], 'npx.cmd');
  assert.equal(updateCommand({ AIS_REF: 'v1.0.0' }, 'linux')[2], 'github:olavomello/ai-project-starter#v1.0.0');
  assert.deepEqual(updateCommand({ AIS_UPDATE_CMD: '["node","-e","1"]' }), ['node', '-e', '1']);
  assert.throws(() => updateCommand({ AIS_UPDATE_CMD: '"nope"' }));
});

test('apply runs the update command, then re-checks so the button can clear', () => {
  const dir = tmp();
  try {
    const repo = makeRemote(dir);
    const head = git(repo, 'rev-parse', 'HEAD');
    const proj = join(dir, 'proj');
    mkdirSync(proj);
    projectWith(proj, SHA_A);
    process.env.AIS_REPO = repo;
    try {
      assert.equal(checkUpdate(proj, { force: true }).available, true);
      // the "update" records the starter's head in the manifest, as the real CLI does
      const write = `require('fs').writeFileSync('.ai-project-starter.json', JSON.stringify({ starterRef: '${head}' }))`;
      const r = applyUpdate(proj, { env: { ...process.env, AIS_UPDATE_CMD: JSON.stringify([process.execPath, '-e', write]) } });
      assert.equal(r.ok, true);
      assert.equal(r.check.available, false);
      const bad = applyUpdate(proj, { env: { ...process.env, AIS_UPDATE_CMD: JSON.stringify([process.execPath, '-e', 'process.exit(3)']) } });
      assert.equal(bad.ok, false);
    } finally { delete process.env.AIS_REPO; }
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

test('the dashboard shuts itself down on a guarded POST, and only then', async () => {
  const dir = tmp();
  const port = 4622;
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), 'x');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@e.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  const child = spawn(process.execPath, [AI_DASH, '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await request(port, 'GET', '/api/config')).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const json = { 'content-type': 'application/json', 'x-ai-dash': '1' };
    assert.equal((await request(port, 'GET', '/api/shutdown')).status, 405);
    assert.equal((await request(port, 'POST', '/api/shutdown', { headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400, 'needs the X-AI-Dash header');
    assert.equal((await request(port, 'POST', '/api/shutdown', { headers: { ...json, host: 'evil.example' }, body: '{}' })).status, 400, 'needs a local Host');
    assert.equal(child.exitCode, null, 'still running after the refused requests');
    assert.equal((await request(port, 'POST', '/api/shutdown', { headers: json, body: '{}' })).status, 200);
    await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('did not exit')), 5000))]);
    assert.equal(child.exitCode, 0);
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
    done(dir);
  }
});
