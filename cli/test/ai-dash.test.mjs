// Tests for ../../template/scripts/ai-dash.mjs's local server (GET/POST
// /api/config, its request-origin checks, and static file serving). Node's
// built-in test runner — not shipped in the npm package.
//
// ai-dash.mjs resolves its ROOT/TARGET_DIR via `git rev-parse` at import
// time and binds a real socket, so each test spawns it as a child process
// in a throwaway git repo with its own ai-dash/ and .claude/ directories,
// rather than importing it directly.
//
// Run: node --test cli/test/ai-dash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

/** node:http lets us send a Host header that doesn't match the socket we
 * actually connect to — fetch() always sets it correctly, so this is the
 * only way to exercise the server's own Host check. */
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MOD_MJS = join(HERE, '..', '..', 'template', 'scripts', 'mod.mjs');
const AI_DASH_MJS = join(HERE, '..', '..', 'template', 'scripts', 'ai-dash.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-dash-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), '<!doctype html><html><body>dash</body></html>');
  writeFileSync(join(dir, 'ai-dash', 'data.json'), '{}');
  writeFileSync(join(dir, '.gitignore'), '');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

async function waitForServer(port, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (res.status) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not come up in time');
}

function startServer(dir, port) {
  const child = spawn(process.execPath, [AI_DASH_MJS, '--port', String(port)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function withServer(port, fn) {
  const dir = makeRepo();
  const child = startServer(dir, port);
  try {
    await waitForServer(port);
    await fn(dir, port);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('GET /api/config reports not-configured on a fresh repo', async () => {
  await withServer(4601, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mod.enabled, null);
  });
});

test('GET / serves ai-dash/index.html', async () => {
  await withServer(4602, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /dash/);
  });
});

test('valid POST /api/config enables the mod and GET reflects it', async () => {
  await withServer(4603, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-dash': '1',
        host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({ mod: { enabled: true } }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mod.enabled, true);

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.enabledPlugins['starter-hud@ai-project-starter'], true);
  });
});

test('POST rejects a wrong Host header', async () => {
  await withServer(4604, async (dir, port) => {
    const body = JSON.stringify({ mod: { enabled: true } });
    const res = await rawRequest(port, {
      method: 'POST',
      path: '/api/config',
      headers: {
        host: 'evil.example.com:9999',
        'content-type': 'application/json',
        'x-ai-dash': '1',
        'content-length': Buffer.byteLength(body),
      },
      body,
    });
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.text).error, /host or origin/);
  });
});

test('POST rejects a mismatched Origin header even with a correct Host', async () => {
  await withServer(4605, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-dash': '1',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ mod: { enabled: true } }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /host or origin/);
  });
});

test('POST rejects a missing X-AI-Dash header', async () => {
  await withServer(4606, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mod: { enabled: true } }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /X-AI-Dash/);
  });
});

test('POST rejects an oversized body', async () => {
  await withServer(4607, async (dir, port) => {
    const big = JSON.stringify({ mod: { enabled: true, pad: 'x'.repeat(5000) } });
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-dash': '1' },
      body: big,
    });
    assert.equal(res.status, 400);
  });
});

test('GET rejects path traversal outside ai-dash/', async () => {
  await withServer(4608, async (dir, port) => {
    const res = await fetch(`http://127.0.0.1:${port}/../../etc/passwd`);
    assert.ok(res.status === 400 || res.status === 404);
  });
});
