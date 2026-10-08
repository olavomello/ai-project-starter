// Tests for the Agents card switch: the Status line in docs/agents/<name>.md and the .claude/agents mirror.
//
// Run: node --test cli/test/agents-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgents, setAgentStatus } from '../../template/scripts/agents-status.mjs';

const agent = (name, status) => `--------------------------------------\n## CONFIGS\nName : ${name}\nDescription : Does ${name} things\nStatus : ${status}\nOwns : src/**\n--------------------------------------\n\n## SCOPE AND RULES\nStatus : keep this line in the body\n`;
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'agents-status-'));
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'agents', 'dev-a.md'), agent('dev-a', 'ON').replace(/\n/g, '\r\n'));
  writeFileSync(join(dir, 'docs', 'agents', '_TEMPLATE.md'), agent('x', 'ON'));
  return dir;
}

test('listAgents reads the roster and skips the template', () => {
  const dir = project();
  try {
    const list = listAgents(dir);
    assert.deepEqual(list.map((a) => [a.name, a.status, a.description]), [['dev-a', 'ON', 'Does dev-a things']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('switching off rewrites only the CONFIGS Status line and removes the mirror; on brings it back', () => {
  const dir = project();
  try {
    assert.equal(setAgentStatus(dir, 'dev-a', 'ON').changed, false);
    assert.ok(existsSync(join(dir, '.claude', 'agents', 'dev-a.md')), 'mirror written');
    const off = setAgentStatus(dir, 'dev-a', 'OFF');
    assert.deepEqual([off.ok, off.changed], [true, true]);
    const text = readFileSync(join(dir, 'docs', 'agents', 'dev-a.md'), 'utf8');
    assert.match(text, /Status : OFF\r\n/);
    assert.match(text, /Status : keep this line in the body/);
    assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'line endings kept');
    assert.equal(existsSync(join(dir, '.claude', 'agents', 'dev-a.md')), false, 'mirror removed');
    setAgentStatus(dir, 'dev-a', 'ON');
    assert.ok(existsSync(join(dir, '.claude', 'agents', 'dev-a.md')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refuses bad names, bad statuses and unknown agents without writing', () => {
  const dir = project();
  try {
    for (const [n, s] of [['../x', 'ON'], ['dev-a', 'MAYBE'], ['nobody', 'ON'], ['_TEMPLATE', 'OFF'], [5, 'ON']]) {
      assert.equal(setAgentStatus(dir, n, s).ok, false, `${n}/${s}`);
    }
    assert.match(readFileSync(join(dir, 'docs', 'agents', 'dev-a.md'), 'utf8'), /Status : ON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
