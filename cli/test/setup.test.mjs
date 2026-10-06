// Tests for the project README template, its placeholder fill, and the
// shipped starter agent. Node's built-in test runner.
//
// Run: node --test cli/test/setup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fillReadme } from '../src/setup.js';
import { isProtected } from '../src/lib/manifest.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('template README has the three placeholders and the Powered by AIS footer', () => {
  const readme = read('template/README.md');
  for (const key of ['{{NAME}}', '{{PURPOSE}}', '{{STACK}}']) assert.ok(readme.includes(key), key);
  const lastLine = readme.trim().split('\n').pop();
  assert.match(lastLine, /Powered by .*AIS/);
});

test('fillReadme fills every placeholder and drops the explanatory comment', () => {
  const out = fillReadme(read('template/README.md'), { name: 'Acme', purpose: 'Sell anvils', stack: 'Node + Postgres' });
  assert.ok(out.startsWith('# Acme\n'));
  assert.ok(out.includes('> Sell anvils'));
  assert.ok(out.includes('**Stack:** Node + Postgres'));
  for (const key of ['{{NAME}}', '{{PURPOSE}}', '{{STACK}}']) assert.ok(!out.includes(key), key);
  assert.ok(!out.includes('<!-- The three'));
});

test('fillReadme leaves an empty answer as a visible placeholder and keeps the comment', () => {
  const out = fillReadme(read('template/README.md'), { name: 'Acme', purpose: '', stack: '  ' });
  assert.ok(out.startsWith('# Acme\n'));
  assert.ok(out.includes('{{PURPOSE}}'));
  assert.ok(out.includes('{{STACK}}'));
  assert.ok(out.includes('<!-- The three'));
});

test('README.md is never auto-applied by update', () => {
  assert.equal(isProtected('README.md'), true);
  assert.equal(isProtected('docs/agents/sys-init-starter.md'), true);
});

test('starter agent file satisfies the doctor and agent-team rules', () => {
  const rel = 'template/docs/agents/sys-init-starter.md';
  const text = read(rel);
  const field = (name) => (text.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, 'm')) || [])[1]?.trim();
  assert.ok(/^##\s*CONFIGS/m.test(text));
  assert.ok(/^##\s*SCOPE AND RULES/m.test(text));
  assert.equal(field('Status'), 'ON');
  assert.equal(field('Name'), 'sys-init-starter');
  assert.match(field('Name'), /^[a-z0-9]{3}-[a-z0-9]+-[a-z0-9]+$/);
  assert.ok(field('Description'));
  assert.ok(field('Owns'));
  assert.match(field('Creation date'), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('template AGENTS.md stays within its documented size', () => {
  assert.ok(read('template/AGENTS.md').trimEnd().split('\n').length <= 140);
});

test('init ships the README and the starter agent, and doctor accepts them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'setup-test-'));
  const target = join(dir, 'proj');
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'cli', 'bin.js'), 'init', target, '--source', ROOT, '--no-prompt'], { encoding: 'utf8' });
    assert.ok(existsSync(join(target, 'README.md')));
    assert.ok(existsSync(join(target, 'docs', 'agents', 'sys-init-starter.md')));
    assert.match(out, /docs\/agents\/sys-init-starter\.md/);
    assert.match(out, /run the starter agent/i);
    assert.ok(readFileSync(join(target, 'README.md'), 'utf8').includes('Powered by'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
