// The optional untangle-codebase skill: inert in the template, applied only when setup says yes.
//
// Run: node --test cli/test/optional-skills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = join(ROOT, 'cli', 'bin.js');
const NAME = 'untangle-codebase';
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const skill = (target, ...a) => spawnSync(process.execPath, [join(target, 'scripts', 'optional-skills.mjs'), ...a, '--dir', target], { encoding: 'utf8' });

function project(extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'optional-skills-'));
  const target = join(dir, 'proj');
  const r = cli(['init', target, '--source', ROOT, '--no-prompt', ...extra]);
  assert.equal(r.status, 0, r.stderr);
  return { dir, target };
}
const live = (target) => join(target, '.claude', 'skills', NAME, 'SKILL.md');

test('the skill ships inert and valid: in docs/optional-skills, not in .claude/skills', () => {
  const tpl = join(ROOT, 'template');
  assert.ok(existsSync(join(tpl, 'docs', 'optional-skills', NAME, 'SKILL.md')));
  assert.ok(!existsSync(join(tpl, '.claude', 'skills', NAME)), 'it must not load for every project');
});

test('init without the flag leaves the skill off; the first commit has no copy of it', () => {
  const { dir, target } = project();
  try {
    assert.ok(!existsSync(live(target)));
    assert.match(skill(target, 'status').stdout, /untangle-codebase: disabled/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('init --untangle applies it before the first commit and the skills check accepts it', () => {
  const { dir, target } = project(['--untangle']);
  try {
    assert.ok(existsSync(live(target)));
    const tracked = execFileSync('git', ['ls-files', `.claude/skills/${NAME}/SKILL.md`], { cwd: target, encoding: 'utf8' });
    assert.match(tracked, /SKILL\.md/, 'committed with the project');
    const check = spawnSync(process.execPath, ['scripts/skills.mjs', 'check', '--json'], { cwd: target, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    const found = JSON.parse(check.stdout).skills.find((s) => s.name === NAME);
    assert.ok(found, 'listed with the other skills');
    assert.deepEqual(found.errors, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--no-untangle wins, and enable/disable are idempotent and never delete an edited copy', () => {
  const { dir, target } = project(['--no-untangle']);
  try {
    assert.ok(!existsSync(live(target)));
    assert.match(skill(target, 'enable', NAME).stdout, /enabled/);
    assert.match(skill(target, 'enable', NAME).stdout, /already enabled/);
    assert.match(skill(target, 'disable', NAME).stdout, /disabled/);
    assert.ok(!existsSync(live(target)));
    assert.match(skill(target, 'disable', NAME).stdout, /already disabled/);

    skill(target, 'enable', NAME);
    writeFileSync(live(target), readFileSync(live(target), 'utf8') + '\nProject rule: also keep the API layer thin.\n');
    assert.match(skill(target, 'disable', NAME).stdout, /kept/);
    assert.ok(existsSync(live(target)), 'a skill the project edited stays');
    assert.match(skill(target, 'enable', NAME).stdout, /local edits/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unknown skill name is refused, listing what exists', () => {
  const { dir, target } = project();
  try {
    const r = skill(target, 'enable', 'nope');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown optional skill "nope".*untangle-codebase/);
    assert.equal(skill(target, 'enable', '../etc').status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the bootstrap prompt asks the question and says how to apply it', () => {
  const prompts = readFileSync(join(ROOT, 'PROMPTS.md'), 'utf8');
  assert.match(prompts, /optional `untangle-codebase` skill/);
  assert.match(prompts, /node scripts\/optional-skills\.mjs enable untangle-codebase/);
});
