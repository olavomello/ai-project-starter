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

// ---- usage measured on other branches ----
function usageDir(dir) {
  const d = join(dir, '.agents', 'state', 'usage');
  mkdirSync(d, { recursive: true });
  return d;
}
const usage = (o) => JSON.stringify({ uncached_in: 0, cache_read: 0, cache_write: 0, out: 0, tool_calls: 0, duration_s: 0, ...o });

test('a gate run on another branch still takes the usage a session measured (the mod writes per session branch)', () => {
  const dir = makeRepo();
  try {
    const other = join(usageDir(dir), 'claude_init-work.json');
    writeFileSync(other, usage({ uncached_in: 100, cache_read: 900, out: 50, tool_calls: 10, duration_s: 60, model: 'claude-sonnet-5-5' }));
    runAiLog(dir, ['--task-type', 'other', '--gate', 'pass']);
    const rec = lastRecord(dir);
    assert.equal(rec.tokens_in, 1000);
    assert.equal(rec.cache_read, 900);
    assert.equal(rec.tokens_out, 50);
    assert.equal(rec.tool_calls, 10);
    assert.equal(rec.model, 'claude-sonnet-5-5');
    assert.ok(!existsSync(other), 'consumed once, so it is not counted twice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage from several branches is summed; the model comes from this branch first, else the biggest session', () => {
  const dir = makeRepo();
  try {
    const d = usageDir(dir);
    writeFileSync(join(d, 'agent_dev-a.json'), usage({ uncached_in: 10, cache_read: 90, out: 5, tool_calls: 2, model: 'small-model' }));
    writeFileSync(join(d, 'claude_big.json'), usage({ uncached_in: 100, cache_read: 9000, out: 500, tool_calls: 40, model: 'big-model', size: 'L' }));
    runAiLog(dir, ['--task-type', 'other', '--gate', 'pass']);
    let rec = lastRecord(dir);
    assert.equal(rec.tokens_in, 10 + 90 + 100 + 9000);
    assert.equal(rec.tool_calls, 42);
    assert.equal(rec.model, 'big-model', 'the session that measured the most');
    assert.equal(rec.size, null, 'a task size belongs to one session, so another branch\'s is not borrowed');

    writeFileSync(join(d, 'agent_dev-a.json'), usage({ uncached_in: 10, model: 'small-model' }));
    writeFileSync(usagePathFor(dir), usage({ uncached_in: 5, model: 'own-model', size: 'S' }));
    writeFileSync(join(d, 'claude_big.json'), usage({ uncached_in: 100000, model: 'big-model' }));
    runAiLog(dir, ['--task-type', 'other', '--gate', 'pass']);
    rec = lastRecord(dir);
    assert.equal(rec.model, 'own-model', 'this branch\'s own file wins for the model');
    assert.equal(rec.size, 'S');
    assert.equal(rec.tokens_in, 100015);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed usage files on other branches are skipped and removed, valid ones still count', () => {
  const dir = makeRepo();
  try {
    const d = usageDir(dir);
    writeFileSync(join(d, 'broken.json'), '{ not json');
    writeFileSync(join(d, 'good.json'), usage({ uncached_in: 7, model: 'm' }));
    runAiLog(dir, ['--task-type', 'other', '--gate', 'pass']);
    assert.equal(lastRecord(dir).tokens_in, 7);
    assert.ok(!existsSync(join(d, 'broken.json')) && !existsSync(join(d, 'good.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
