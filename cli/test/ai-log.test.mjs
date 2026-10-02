// Tests for ../../template/scripts/ai-log.mjs: the flag > usage-file > env
// var precedence, the tokens_in mapping, usage-file deletion after logging,
// and a malformed usage file being ignored. ai-log.mjs is a CLI script
// (not a module of exported functions), so each case runs it as a child
// process against a throwaway git repo. Node's built-in test runner — not
// shipped in the npm package.
//
// Run: node --test cli/test/ai-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const AI_LOG_MJS = join(HERE, '..', '..', 'template', 'scripts', 'ai-log.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-log-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.agents/\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function branchOf(dir) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

function usagePathFor(dir) {
  const branch = branchOf(dir); // 'main' in a fresh repo, no sanitizing needed
  return join(dir, '.agents', 'state', 'usage', `${branch}.json`);
}

function runAiLog(dir, args, env = {}) {
  return execFileSync(process.execPath, [AI_LOG_MJS, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function lastRecord(dir) {
  const log = join(dir, '.agents', 'log', 'executions.jsonl');
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

test('a usage file supplies tokens_in as the total (uncached + cache_read + cache_write)', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'state', 'usage'), { recursive: true });
  writeFileSync(usagePathFor(dir), JSON.stringify({
    uncached_in: 1000, cache_read: 4000, cache_write: 500, out: 200, tool_calls: 3, duration_s: 12, model: 'claude-opus-5',
  }));
  runAiLog(dir, ['--task-type', 'other']);
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 5500);
  assert.equal(rec.tokens_out, 200);
  assert.equal(rec.cache_read, 4000);
  assert.equal(rec.cache_write, 500);
  assert.equal(rec.tool_calls, 3);
  assert.equal(rec.duration_s, 12);
  assert.equal(rec.model, 'claude-opus-5');
  rmSync(dir, { recursive: true, force: true });
});

test('the usage file is deleted after logging', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'state', 'usage'), { recursive: true });
  const path = usagePathFor(dir);
  writeFileSync(path, JSON.stringify({ uncached_in: 10, cache_read: 0, cache_write: 0, out: 5 }));
  runAiLog(dir, ['--task-type', 'other']);
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a malformed usage file is ignored silently, and is still deleted', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'state', 'usage'), { recursive: true });
  const path = usagePathFor(dir);
  writeFileSync(path, '{ not json at all');
  // Should not throw, and should fall back to defaults (0 / unset).
  runAiLog(dir, ['--task-type', 'other']);
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 0);
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true, force: true });
});

test('precedence: an explicit flag overrides the usage file for that field only', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'state', 'usage'), { recursive: true });
  writeFileSync(usagePathFor(dir), JSON.stringify({ uncached_in: 1000, cache_read: 0, cache_write: 0, out: 200, tool_calls: 7, duration_s: 9 }));
  runAiLog(dir, ['--task-type', 'other', '--tokens-in', '42']);
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 42); // flag wins
  assert.equal(rec.tokens_out, 200); // still from the usage file
  assert.equal(rec.tool_calls, 7); // still from the usage file
  rmSync(dir, { recursive: true, force: true });
});

test('precedence: the usage file overrides an AILOG_* env var for the same field', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'state', 'usage'), { recursive: true });
  writeFileSync(usagePathFor(dir), JSON.stringify({ uncached_in: 1000, cache_read: 0, cache_write: 0, out: 200 }));
  runAiLog(dir, ['--task-type', 'other'], { AILOG_TOKENS_IN: '99999' });
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 1000); // usage file wins over env var
  rmSync(dir, { recursive: true, force: true });
});

test('precedence: with no usage file, an AILOG_* env var still works (bare AILOG_* run)', () => {
  const dir = makeRepo();
  runAiLog(dir, ['--task-type', 'other'], { AILOG_TOKENS_IN: '777', AILOG_AGENT: 'dev-api-tester' });
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 777);
  assert.equal(rec.agent, 'dev-api-tester');
  rmSync(dir, { recursive: true, force: true });
});

test('with neither a usage file nor env vars, measured fields default to 0 (bare pass/fail)', () => {
  const dir = makeRepo();
  runAiLog(dir, ['--task-type', 'other']);
  const rec = lastRecord(dir);
  assert.equal(rec.tokens_in, 0);
  assert.equal(rec.tokens_out, 0);
  assert.equal(rec.agent, 'main');
  rmSync(dir, { recursive: true, force: true });
});
