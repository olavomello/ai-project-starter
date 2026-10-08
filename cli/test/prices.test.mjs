// Tests for the model-prices editor: the file helpers and the guarded HTTP endpoint.
//
// Run: node --test cli/test/prices.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readPrices, parseModels, writePrices } from '../../template/scripts/prices.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEMPLATE = join(ROOT, 'template');
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prices-test-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  return dir;
};

test('the shipped file holds dated starting prices that the report accepts', () => {
  const shipped = JSON.parse(readFileSync(join(TEMPLATE, 'docs', 'model-prices.json'), 'utf8'));
  assert.match(shipped.updated, /^\d{4}-\d{2}-\d{2}$/);
  const names = Object.keys(shipped.models);
  assert.ok(names.length >= 5 && names.every((n) => !n.startsWith('example')));
  assert.equal(parseModels(shipped).ok, true);
  for (const m of Object.values(shipped.models)) assert.ok(m.in > 0 && m.out > m.in);
});

test('parseModels accepts numbers and numeric text, refuses bad names and prices', () => {
  assert.deepEqual(parseModels({ models: { 'gpt-4.1': { in: '2', out: 8, cache_read: '', cache_write: undefined } } }),
    { ok: true, models: { 'gpt-4.1': { in: 2, out: 8, cache_read: 0, cache_write: 0 } } });
  assert.equal(parseModels({ models: { '../etc': { in: 1 } } }).ok, false);
  assert.equal(parseModels({ models: { m: { in: -1 } } }).ok, false);
  assert.equal(parseModels({ models: { m: { in: 'abc' } } }).ok, false);
  assert.equal(parseModels({ models: { m: { in: 1e9 } } }).ok, false);
  assert.equal(parseModels({ models: [] }).ok, false);
  assert.equal(parseModels(null).ok, false);
});

test('writePrices keeps the file notes, replaces the models and stamps the date', () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'docs', 'model-prices.json'), JSON.stringify({ _comment: 'keep me', updated: '2020-01-01', models: { old: { in: 1, out: 2 } } }));
    const out = writePrices(dir, { 'claude-sonnet-5-5': { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75 } }, new Date(2026, 9, 7));
    assert.equal(out.updated, '2026-10-07');
    const file = JSON.parse(readFileSync(join(dir, 'docs', 'model-prices.json'), 'utf8'));
    assert.equal(file._comment, 'keep me');
    assert.deepEqual(Object.keys(file.models), ['claude-sonnet-5-5']);
    assert.deepEqual(readPrices(dir).models['claude-sonnet-5-5'], { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readPrices reports a missing file and a broken one without throwing', () => {
  const dir = project();
  try {
    assert.deepEqual(readPrices(dir), { exists: false, updated: '', models: {} });
    writeFileSync(join(dir, 'docs', 'model-prices.json'), '{ nope');
    assert.match(readPrices(dir).error, /not valid JSON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function request(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('GET and POST api/prices work behind the same guard as the other writes', async () => {
  const dir = project();
  const { cpSync } = await import('node:fs');
  cpSync(join(TEMPLATE, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(TEMPLATE, 'ai-dash'), join(dir, 'ai-dash'), { recursive: true });
  cpSync(join(TEMPLATE, 'docs', 'model-prices.json'), join(dir, 'docs', 'model-prices.json'));
  const port = 4300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['scripts/ai-dash.mjs', '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((r) => child.on('exit', r));
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await request(port, 'GET', '/api/config')).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const got = JSON.parse((await request(port, 'GET', '/api/prices')).text);
    assert.equal(got.exists, true);
    assert.ok(got.models['claude-sonnet-5-5']);
    assert.equal((await request(port, 'GET', '/api/prices', { headers: { host: 'evil.example' } })).status, 400);

    const json = { 'content-type': 'application/json', 'x-ai-dash': '1' };
    const post = (headers, body) => request(port, 'POST', '/api/prices', { headers, body });
    const models = { 'my-model': { in: 1.5, out: 6, cache_read: 0.15, cache_write: 1.9 } };
    assert.equal((await post({ 'content-type': 'application/json' }, JSON.stringify({ models }))).status, 400, 'needs the X-AI-Dash header');
    assert.equal((await post({ ...json, host: 'evil.example' }, JSON.stringify({ models }))).status, 400, 'needs a local Host');
    assert.equal((await post(json, '{ nope')).status, 400);
    assert.equal((await post(json, JSON.stringify({ models: { 'bad name': { in: 1 } } }))).status, 400);
    assert.ok(JSON.parse(readFileSync(join(dir, 'docs', 'model-prices.json'), 'utf8')).models['claude-sonnet-5-5'], 'refused requests changed nothing');

    const ok = await post(json, JSON.stringify({ models }));
    assert.equal(ok.status, 200);
    const saved = JSON.parse(readFileSync(join(dir, 'docs', 'model-prices.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved.models), ['my-model']);
    assert.match(saved.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await request(port, 'DELETE', '/api/prices')).status, 405);
  } finally {
    child.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
