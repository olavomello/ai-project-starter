// Tests for template/scripts/skills.mjs (frontmatter parser/validator, listing,
// CLI exit codes) and ai-dash's GET /api/skills. Node's built-in runner.
// Run: node --test cli/test/skills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateSkill, listSkills } from '../../template/scripts/skills.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const SKILLS_MJS = join(ROOT, 'template', 'scripts', 'skills.mjs');
const AI_DASH_MJS = join(ROOT, 'template', 'scripts', 'ai-dash.mjs');
const GOOD_DESC = 'Does a useful thing for the project. Use when the task needs that useful thing done.';

const check = (dirName, text) => validateSkill(dirName, parseFrontmatter(text));
const skill = (name, desc, extra = '') => `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\nBody\n`;

function project(skills) {
  const dir = mkdtempSync(join(tmpdir(), 'skills-test-'));
  for (const [folder, text] of Object.entries(skills)) {
    mkdirSync(join(dir, '.claude', 'skills', folder), { recursive: true });
    if (text !== null) writeFileSync(join(dir, '.claude', 'skills', folder, 'SKILL.md'), text);
  }
  return dir;
}

test('a complete skill passes with no errors or warnings', () => {
  const r = check('my-skill', skill('my-skill', GOOD_DESC));
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('quoted and block-scalar descriptions parse', () => {
  assert.equal(parseFrontmatter(`---\nname: a\ndescription: "Has: a colon # and hash"\n---\n`).data.description, 'Has: a colon # and hash');
  assert.equal(parseFrontmatter(`---\nname: a\ndescription: >\n  line one\n  line two\n---\n`).data.description, 'line one line two');
});

test('missing frontmatter, unclosed frontmatter, missing fields', () => {
  assert.match(check('a', 'no header').errors[0], /must start with/);
  assert.match(check('a', '---\nname: a\n').errors[0], /never closed/);
  const r = check('a', '---\nother: x\n---\n');
  assert.ok(r.errors.includes('missing required field: name'));
  assert.ok(r.errors.includes('missing required field: description'));
});

test('name must be lowercase-hyphen and equal the folder', () => {
  assert.ok(check('a', skill('Bad_Name', GOOD_DESC)).errors.some((e) => /lowercase/.test(e)));
  assert.ok(check('folder', skill('other', GOOD_DESC)).errors.some((e) => /match its folder/.test(e)));
});

test('description length limit and unquoted-YAML pitfalls are errors', () => {
  assert.ok(check('a', skill('a', 'x'.repeat(1025))).errors.some((e) => /1025/.test(e)));
  assert.ok(check('a', skill('a', 'Run this: it does things')).errors.some((e) => /": "/.test(e)));
  assert.ok(check('a', skill('a', 'Run this # not a comment')).errors.some((e) => /" #"/.test(e)));
  assert.ok(check('a', skill('a', '[bracketed] text')).errors.some((e) => /starting with/.test(e)));
  assert.ok(check('a', '---\nname: a\ndescription: "never closed\n---\n').errors.some((e) => /never closed/.test(e)));
  assert.ok(check('a', skill('a', GOOD_DESC, 'name: dup\n')).errors.some((e) => /duplicate key/.test(e)));
});

test('weak descriptions only warn', () => {
  const short = check('a', skill('a', 'Too short'));
  assert.equal(short.errors.length, 0);
  assert.ok(short.warnings.some((w) => /very short/.test(w)));
  const noCue = check('a', skill('a', 'Formats documents according to the house style of the team.'));
  assert.ok(noCue.warnings.some((w) => /when to use/.test(w)));
});

test('extra optional keys are accepted', () => {
  assert.deepEqual(check('a', skill('a', GOOD_DESC, 'disable-model-invocation: true\n')).errors, []);
});

test('listSkills reports a folder without SKILL.md and sorts by folder', () => {
  const dir = project({ zeta: skill('zeta', GOOD_DESC), alpha: skill('alpha', GOOD_DESC), empty: null });
  try {
    const list = listSkills(dir);
    assert.deepEqual(list.map((s) => s.dir), ['alpha', 'empty', 'zeta']);
    assert.deepEqual(list.find((s) => s.dir === 'empty').errors, ['missing SKILL.md']);
    assert.equal(list[0].description, GOOD_DESC);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the skills shipped in the template are valid', () => {
  const bad = listSkills(join(ROOT, 'template')).filter((s) => s.errors.length);
  assert.deepEqual(bad, []);
});

test('CLI check exits 0 when valid, 1 on error, and --strict fails on warnings', () => {
  const ok = project({ a: skill('a', GOOD_DESC) });
  const bad = project({ a: skill('wrong', GOOD_DESC) });
  const weak = project({ a: skill('a', 'Too short') });
  try {
    const run = (dir, ...flags) => spawnSync(process.execPath, [SKILLS_MJS, 'check', '--dir', dir, ...flags], { encoding: 'utf8' });
    assert.equal(run(ok).status, 0);
    assert.equal(run(bad).status, 1);
    assert.match(run(bad).stderr, /FAIL/);
    assert.equal(run(weak).status, 0);
    assert.equal(run(weak, '--strict').status, 1);
    assert.equal(JSON.parse(run(ok, '--json').stdout).skills[0].name, 'a');
  } finally { for (const d of [ok, bad, weak]) rmSync(d, { recursive: true, force: true }); }
});

test('GET /api/skills lists name/description (no bodies) and enforces Host', async () => {
  const dir = project({ a: skill('a', GOOD_DESC).replace('Body', 'SECRET-BODY') });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  mkdirSync(join(dir, 'ai-dash'), { recursive: true });
  writeFileSync(join(dir, 'ai-dash', 'index.html'), 'x');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  const port = 4609;
  const child = spawn(process.execPath, [AI_DASH_MJS, '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).status) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/skills`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('SECRET-BODY'));
    const { skills } = JSON.parse(text);
    assert.equal(skills[0].name, 'a');
    assert.equal(skills[0].description, GOOD_DESC);
    const bad = await fetch(`http://127.0.0.1:${port}/api/skills`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(bad.status, 400);
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
