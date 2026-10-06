// Tests for template/scripts/agents-sync.mjs (roster -> .claude/agents/ mirror).
// Node's built-in test runner.
//
// Run: node --test cli/test/agents-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { field, mirrorContent, syncClaudeAgents, MARKER } from '../../template/scripts/agents-sync.mjs';

const SCRIPT = fileURLToPath(new URL('../../template/scripts/agents-sync.mjs', import.meta.url));

function agentFile(name, { description = 'Does a thing', status = 'ON' } = {}) {
  return `--------------------------------------\n## CONFIGS\nName : ${name}\nDescription : ${description}\nStatus : ${status}\nOwns : src/**\nCreated by : Main\nCreation date : 2026-10-06 00:00:00\n--------------------------------------\n\n## SCOPE AND RULES\n\nRules.\n`;
}

function project(agents) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-sync-'));
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'agents', '_TEMPLATE.md'), agentFile('<nnn-area-role>'));
  for (const [name, opts] of Object.entries(agents)) writeFileSync(join(dir, 'docs', 'agents', `${name}.md`), agentFile(name, opts));
  return dir;
}
const mirror = (dir, name) => join(dir, '.claude', 'agents', `${name}.md`);
const done = (dir) => rmSync(dir, { recursive: true, force: true });

test('field reads a CONFIGS value, with CRLF too', () => {
  assert.equal(field(agentFile('dev-api-tester'), 'Name'), 'dev-api-tester');
  assert.equal(field(agentFile('dev-api-tester').replace(/\n/g, '\r\n'), 'Status'), 'ON');
  assert.equal(field('nothing here', 'Name'), '');
});

test('mirror content is valid frontmatter with a safely quoted description', () => {
  const text = mirrorContent('dev-api-tester', 'Tests: the "orders" API # now');
  assert.ok(text.startsWith('---\nname: dev-api-tester\ndescription: '));
  const desc = text.split('\n')[2].slice('description: '.length);
  assert.equal(JSON.parse(desc), 'Tests: the "orders" API # now');
  assert.ok(text.includes(MARKER));
  assert.ok(text.includes('docs/agents/dev-api-tester.md'));
});

test('sync creates a mirror for each ON agent, skips OFF agents and the template', () => {
  const dir = project({ 'dev-api-tester': {}, 'doc-sdk-writer': { status: 'OFF' } });
  try {
    const { agents, problems } = syncClaudeAgents(dir);
    assert.deepEqual(agents, ['dev-api-tester']);
    assert.equal(problems.length, 1);
    assert.ok(existsSync(mirror(dir, 'dev-api-tester')));
    assert.ok(!existsSync(mirror(dir, 'doc-sdk-writer')));
    assert.ok(!existsSync(mirror(dir, '_TEMPLATE')));
    assert.deepEqual(syncClaudeAgents(dir, { check: true }).problems, []);
  } finally { done(dir); }
});

test('check reports drift without writing; sync repairs it', () => {
  const dir = project({ 'dev-api-tester': {} });
  try {
    assert.equal(syncClaudeAgents(dir, { check: true }).problems.length, 1);
    assert.ok(!existsSync(mirror(dir, 'dev-api-tester')));
    syncClaudeAgents(dir);
    writeFileSync(mirror(dir, 'dev-api-tester'), readFileSync(mirror(dir, 'dev-api-tester'), 'utf8') + 'edited\n');
    assert.match(syncClaudeAgents(dir, { check: true }).problems[0], /out of date/);
    syncClaudeAgents(dir);
    assert.deepEqual(syncClaudeAgents(dir, { check: true }).problems, []);
  } finally { done(dir); }
});

test('removing or switching off an agent removes only its generated mirror', () => {
  const dir = project({ 'dev-api-tester': {}, 'doc-sdk-writer': {} });
  try {
    syncClaudeAgents(dir);
    writeFileSync(join(dir, '.claude', 'agents', 'hand-written.md'), '---\nname: hand-written\ndescription: mine\n---\nmine\n');
    rmSync(join(dir, 'docs', 'agents', 'dev-api-tester.md'));
    writeFileSync(join(dir, 'docs', 'agents', 'doc-sdk-writer.md'), agentFile('doc-sdk-writer', { status: 'OFF' }));
    syncClaudeAgents(dir);
    assert.ok(!existsSync(mirror(dir, 'dev-api-tester')));
    assert.ok(!existsSync(mirror(dir, 'doc-sdk-writer')));
    assert.ok(existsSync(join(dir, '.claude', 'agents', 'hand-written.md')));
  } finally { done(dir); }
});

test('a hand-written subagent with the same name is reported and left untouched', () => {
  const dir = project({ 'dev-api-tester': {} });
  try {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(mirror(dir, 'dev-api-tester'), 'mine\n');
    const { problems } = syncClaudeAgents(dir);
    assert.match(problems[0], /not generated here/);
    assert.equal(readFileSync(mirror(dir, 'dev-api-tester'), 'utf8'), 'mine\n');
  } finally { done(dir); }
});

test('CLI: --check --json exits 1 on drift and 0 when in sync (native Windows paths too)', () => {
  const dir = project({ 'dev-api-tester': {} });
  try {
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...args], { encoding: 'utf8' });
    const drift = run('--check', '--json');
    assert.equal(drift.status, 1);
    assert.equal(JSON.parse(drift.stdout).problems.length, 1);
    assert.equal(run().status, 0);
    const ok = run('--check', '--json');
    assert.equal(ok.status, 0);
    assert.deepEqual(JSON.parse(ok.stdout), { agents: ['dev-api-tester'], problems: [] });
  } finally { done(dir); }
});

test('the starter agent shipped in the template has an up-to-date mirror', () => {
  const root = fileURLToPath(new URL('../../template', import.meta.url));
  assert.deepEqual(syncClaudeAgents(root, { check: true }).problems, []);
  assert.ok(existsSync(join(root, '.claude', 'agents', 'sys-init-starter.md')));
});
