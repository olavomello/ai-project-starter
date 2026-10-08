// Tests for the Tasks card data: taxonomy order, markers, statuses.
//
// Run: node --test cli/test/tasks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTaxonomy, readTasks, startTask, finishTask, MARKER_TTL_MS } from '../../template/scripts/tasks.mjs';

const TEMPLATE_TASKS = readFileSync(fileURLToPath(new URL('../../template/docs/tasks.md', import.meta.url)), 'utf8');
const NOW = Date.parse('2026-10-08T12:00:00Z');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-test-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'log'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'tasks.md'), TEMPLATE_TASKS);
  return dir;
}

test('parseTaxonomy keeps the order of the file, including CRLF files', () => {
  const list = parseTaxonomy(TEMPLATE_TASKS.replace(/\n/g, '\r\n'));
  assert.equal(list[0].type, 'plan');
  assert.equal(list.at(-1).type, 'other');
  assert.equal(list.length, 14);
  assert.ok(list.every((t) => t.covers));
  assert.equal(parseTaxonomy('| `a` | x |\n| `a` | dup |\n').length, 1);
});

test('statuses: working, in-progress, recent, idle, and run counts', () => {
  const dir = project();
  try {
    writeFileSync(join(dir, '.agents', 'log', 'executions.jsonl'), [
      { ts: new Date(NOW - 5 * 60000).toISOString(), task_type: 'build-feature', agent: 'dev-web' },
      { ts: new Date(NOW - 3 * 86400000).toISOString(), task_type: 'fix-bug', agent: 'dev-api' },
      { ts: new Date(NOW - 2 * 86400000).toISOString(), task_type: 'fix-bug', agent: 'dev-api' },
    ].map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n');
    assert.deepEqual(startTask(dir, 'plan', 'dev-api', NOW), { ok: true });
    startTask(dir, 'research', 'dev-gone', NOW);
    const by = Object.fromEntries(readTasks(dir, { running: ['dev-api'], now: NOW }).map((t) => [t.type, t]));
    assert.equal(by.plan.status, 'working');
    assert.equal(by.plan.agent, 'dev-api');
    assert.equal(by.research.status, 'in-progress');
    assert.equal(by['build-feature'].status, 'recent');
    assert.equal(by['fix-bug'].status, 'idle');
    assert.equal(by['fix-bug'].runs, 2);
    assert.equal(by['fix-bug'].lastRun, NOW - 2 * 86400000);
    assert.equal(readTasks(dir, { now: NOW })[0].order, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a marker expires, done clears it, and unknown or malformed names are refused', () => {
  const dir = project();
  try {
    startTask(dir, 'ops', '', NOW);
    assert.equal(readTasks(dir, { now: NOW + MARKER_TTL_MS + 1 }).find((t) => t.type === 'ops').status, 'idle');
    assert.equal(readTasks(dir, { now: NOW + 1000 }).find((t) => t.type === 'ops').status, 'in-progress');
    assert.equal(finishTask(dir, 'ops', NOW + 1000).had, true);
    assert.equal(readTasks(dir, { now: NOW + 1000 }).find((t) => t.type === 'ops').status, 'idle');
    for (const [t, a] of [['invented', ''], ['../x', ''], ['plan', 'bad name!']]) assert.equal(startTask(dir, t, a, NOW).ok, false, t);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no docs/tasks.md gives an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-empty-'));
  try { assert.deepEqual(readTasks(dir), []); } finally { rmSync(dir, { recursive: true, force: true }); }
});
