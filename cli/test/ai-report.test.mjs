// Test for the corrected cost() formula in
// ../../template/scripts/ai-report.mjs: tokens_in is TOTAL input (uncached +
// cache_read + cache_write), so only the uncached remainder is priced at the
// plain `in` rate — pricing the full tokens_in at `in` on top of pricing
// cache_read/cache_write separately would double-charge the cached portion.
// ai-report.mjs is a run-once script (reads the log, writes data.json, and
// exits if the log is empty), so this runs it as a child process against a
// throwaway git repo with one log record and a filled-in price table, and
// checks the emitted ai-dash/data.json's cost field against a hand-computed
// expectation. Node's built-in test runner — not shipped in the npm package.
//
// Run: node --test cli/test/ai-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const AI_REPORT_MJS = join(HERE, '..', '..', 'template', 'scripts', 'ai-report.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-report-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.agents/\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

test('cost() prices only the uncached remainder at the `in` rate (no double-charge)', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'log'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });

  // tokens_in = 5500 is TOTAL input: 1000 uncached + 4000 cache_read + 500 cache_write.
  const rec = {
    ts: new Date().toISOString(), task_type: 'other', agent: 'main', model: 'claude-opus-5',
    size: null, tokens_in: 5500, tokens_out: 200, cache_read: 4000, cache_write: 500,
    tool_calls: 1, duration_s: 5, gate: 'pass', gate_first_try: true, pr: 'none', outcome: 'none',
  };
  writeFileSync(join(dir, '.agents', 'log', 'executions.jsonl'), JSON.stringify(rec) + '\n');

  const prices = { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75 };
  writeFileSync(join(dir, 'docs', 'model-prices.json'), JSON.stringify({ models: { 'claude-opus-5': prices } }));

  execFileSync(process.execPath, [AI_REPORT_MJS, '--quiet'], { cwd: dir });

  const data = JSON.parse(readFileSync(join(dir, 'ai-dash', 'data.json'), 'utf8'));

  const uncachedIn = 5500 - 4000 - 500; // 1000
  const expectedUsd = (uncachedIn * prices.in + rec.tokens_out * prices.out
    + rec.cache_read * prices.cache_read + rec.cache_write * prices.cache_write) / 1e6;

  assert.equal(data.cost.usd, +expectedUsd.toFixed(4));
  assert.equal(data.cost.priced_executions, 1);
  assert.equal(data.cost.unpriced, 0);
  // Hand-computed sanity check, independent of reading the source back:
  // (1000*3 + 200*15 + 4000*0.3 + 500*3.75) / 1e6 = 0.009075
  assert.equal(data.cost.usd, 0.0091); // rounded to 4dp, matching ai-report.mjs's +c.toFixed(4)

  rmSync(dir, { recursive: true, force: true });
});

test('a record whose model has no price entry is excluded from cost but still counted as unpriced', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, '.agents', 'log'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });

  const recs = [
    { ts: new Date().toISOString(), task_type: 'other', agent: 'main', model: 'claude-opus-5', size: null, tokens_in: 1000, tokens_out: 100, cache_read: 0, cache_write: 0, tool_calls: 1, duration_s: 1, gate: 'pass', gate_first_try: true, pr: 'none', outcome: 'none' },
    { ts: new Date().toISOString(), task_type: 'other', agent: 'main', model: 'unpriced-model', size: null, tokens_in: 1000, tokens_out: 100, cache_read: 0, cache_write: 0, tool_calls: 1, duration_s: 1, gate: 'pass', gate_first_try: true, pr: 'none', outcome: 'none' },
  ];
  writeFileSync(join(dir, '.agents', 'log', 'executions.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dir, 'docs', 'model-prices.json'), JSON.stringify({ models: { 'claude-opus-5': { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75 } } }));

  execFileSync(process.execPath, [AI_REPORT_MJS, '--quiet'], { cwd: dir });
  const data = JSON.parse(readFileSync(join(dir, 'ai-dash', 'data.json'), 'utf8'));

  assert.equal(data.cost.priced_executions, 1);
  assert.equal(data.cost.unpriced, 1);

  rmSync(dir, { recursive: true, force: true });
});
