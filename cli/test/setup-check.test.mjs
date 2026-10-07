// Tests for the setup chain: installing and checking the mod plugin through the
// claude CLI (always stubbed here), `doctor`'s setup checks, `doctor --fix`, and the
// post-update check. Node's built-in test runner.
//
// Run: node --test cli/test/setup-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modInstalled, installMod, installCommands, MOD_ID } from '../src/lib/claude-plugin.js';
import { checkSetup, fixSetup } from '../src/lib/setup-check.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = join(ROOT, 'cli', 'bin.js');
const cli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });
const ok = (stdout = '') => ({ ok: true, stdout, stderr: '', missing: false });
const fail = (stderr = '') => ({ ok: false, stdout: '', stderr, missing: false });

/** A project made by `init` (no prompts, mod off) in a temp dir. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'setup-check-'));
  const target = join(dir, 'proj');
  const r = cli(['init', target, '--source', ROOT, '--no-prompt']);
  assert.equal(r.status, 0, r.stderr);
  return { dir, target };
}
const settingsOf = (target) => JSON.parse(readFileSync(join(target, '.claude', 'settings.json'), 'utf8'));
const writeSettings = (target, s) => writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
const levels = (found) => found.map((f) => `${f.level}:${f.msg.slice(0, 40)}`);
const git = (target, ...args) => execFileSync('git', args, { cwd: target, stdio: 'ignore' });

test('modInstalled reads the claude plugin list, and says null when it cannot', () => {
  const list = (items) => () => ok(JSON.stringify(items));
  assert.equal(modInstalled('.', list([{ id: MOD_ID, enabled: true }])), true);
  assert.equal(modInstalled('.', list([{ id: MOD_ID, enabled: false, projectEnabled: true }])), true);
  assert.equal(modInstalled('.', list([{ id: MOD_ID, enabled: false }])), false);
  assert.equal(modInstalled('.', list([{ id: 'other@x', enabled: true }])), false);
  assert.equal(modInstalled('.', () => fail('boom')), null);
  assert.equal(modInstalled('.', () => ok('not json')), null);
});

test('installMod adds the marketplace then installs at project scope', () => {
  const calls = [];
  const r = installMod({ cwd: '/p', ref: 'main', run: (args, o) => { calls.push([args.join(' '), o.cwd]); return ok(); } });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [
    ['plugin marketplace add olavomello/ai-project-starter#main', '/p'],
    [`plugin install ${MOD_ID} --scope project`, '/p'],
  ]);
});

test('installMod tolerates an already-added marketplace and reports a failed install with the manual commands', () => {
  const again = installMod({ cwd: '.', run: (args) => (args[1] === 'marketplace' ? fail('Marketplace already exists') : ok()) });
  assert.equal(again.ok, true);
  const bad = installMod({ cwd: '.', ref: 'v1.0.0', run: (args) => (args[1] === 'install' ? fail('no such plugin') : ok()) });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.manual, [installCommands('v1.0.0')[1]]);
  const noAdd = installMod({ cwd: '.', run: () => fail('network down') });
  assert.equal(noAdd.ok, false);
  assert.equal(noAdd.steps.length, 1, 'does not try to install after the marketplace failed');
  assert.deepEqual(noAdd.manual, installCommands('main'));
});

test('a fresh init project has a clean setup: hooks, deny rules, nothing uncommitted', () => {
  const { dir, target } = project();
  try {
    const found = checkSetup(target, { run: () => { throw new Error('claude must not be called when the mod is off'); } });
    assert.ok(found.some((f) => f.level === 'ok' && /live-agent hooks/.test(f.msg)), levels(found).join(' | '));
    assert.ok(!found.some((f) => f.level === 'warn'), levels(found).join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkSetup names each broken link of the chain with its fix', () => {
  const { dir, target } = project();
  try {
    const s = settingsOf(target);
    delete s.hooks.SubagentStart;
    delete s.permissions;
    s.enabledPlugins = { [MOD_ID]: true };
    s.extraKnownMarketplaces = { 'ai-project-starter': { source: { source: 'github', repo: 'olavomello/ai-project-starter', ref: 'v0.1.0' } } };
    writeSettings(target, s);
    const found = checkSetup(target, { run: () => ok('[]') }); // claude says: plugin not installed
    const warns = found.filter((f) => f.level === 'warn').map((f) => f.msg).join(' | ');
    assert.match(warns, /live-agent hooks missing .*SubagentStart/);
    assert.match(warns, /no deny rule/);
    assert.match(warns, /pinned to v0\.1\.0/);
    assert.match(warns, /not installed on this machine/);
    assert.match(warns, /uncommitted setup file/);
    assert.ok(found.filter((f) => f.level === 'warn').every((f) => f.fix), 'every warning carries a fix');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkSetup says info, not a failure, when the claude CLI cannot be asked', () => {
  const { dir, target } = project();
  try {
    const s = settingsOf(target);
    s.enabledPlugins = { [MOD_ID]: true };
    s.extraKnownMarketplaces = { 'ai-project-starter': { source: { source: 'github', repo: 'olavomello/ai-project-starter', ref: 'main' } } };
    writeSettings(target, s);
    const found = checkSetup(target, { run: () => fail('claude: command not found') });
    assert.ok(found.some((f) => f.level === 'info' && /could not ask the claude CLI/.test(f.msg)));
    assert.ok(!found.some((f) => /not installed/.test(f.msg)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('uncommitted setup files are flagged and clear after a commit; worktree folders are ignored', () => {
  const { dir, target } = project();
  try {
    writeFileSync(join(target, 'scripts', 'new-helper.mjs'), '// x');
    mkdirSync(join(target, '.claude', 'worktrees', 'wt-1'), { recursive: true });
    writeFileSync(join(target, '.claude', 'worktrees', 'wt-1', 'file.txt'), 'x');
    const dirty = checkSetup(target).filter((f) => f.level === 'warn');
    assert.equal(dirty.length, 1);
    assert.match(dirty[0].msg, /1 uncommitted setup file /);
    assert.match(dirty[0].fix, /git add -A && git commit/);
    git(target, 'config', 'user.email', 't@e.com'); git(target, 'config', 'user.name', 'T');
    git(target, 'add', 'scripts'); git(target, 'commit', '-q', '-m', 'x');
    assert.equal(checkSetup(target).filter((f) => f.level === 'warn').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fixSetup restores hooks, deny rules and the pin, resyncs agents, and installs the missing plugin', () => {
  const { dir, target } = project();
  try {
    const template = readFileSync(join(ROOT, 'template', '.claude', 'settings.json'), 'utf8');
    const s = settingsOf(target);
    delete s.hooks.SubagentStart; delete s.hooks.Stop; delete s.permissions;
    s.enabledPlugins = { [MOD_ID]: true };
    s.extraKnownMarketplaces = { 'ai-project-starter': { source: { source: 'github', repo: 'olavomello/ai-project-starter', ref: 'v0.1.0' } } };
    writeSettings(target, s);
    rmSync(join(target, '.claude', 'agents'), { recursive: true, force: true });
    const calls = [];
    const run = (args) => { calls.push(args.join(' ')); return args[0] === 'plugin' && args[1] === 'list' ? ok('[]') : ok(); };
    const results = fixSetup(target, { templateSettingsText: template, run });
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    const fixed = settingsOf(target);
    assert.ok(fixed.hooks.SubagentStart && fixed.hooks.Stop && fixed.permissions.deny.includes('Read(.env)'));
    assert.equal(fixed.extraKnownMarketplaces['ai-project-starter'].source.ref, 'main');
    assert.ok(readFileSync(join(target, '.claude', 'agents', 'sys-init-starter.md'), 'utf8').includes('sys-init-starter'));
    assert.ok(calls.some((c) => c.startsWith('plugin marketplace add')) && calls.some((c) => c.startsWith('plugin install')));
    const again = checkSetup(target, { run: (args) => (args[1] === 'list' ? ok(JSON.stringify([{ id: MOD_ID, enabled: true }])) : ok()) });
    assert.ok(!again.some((f) => f.level === 'warn' && !/uncommitted/.test(f.msg)), levels(again).join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doctor --fix repairs a project from the command line', () => {
  const { dir, target } = project();
  try {
    const s = settingsOf(target);
    delete s.hooks.UserPromptSubmit; delete s.hooks.PreToolUse;
    writeSettings(target, s);
    const r = cli(['doctor', target, '--fix', '--source', ROOT]);
    assert.match(r.stdout + r.stderr, /Fixing what can be fixed/);
    const fixed = settingsOf(target);
    assert.ok(fixed.hooks.UserPromptSubmit && fixed.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command.includes('agent-live.mjs tool'))));
    assert.ok(fixed.hooks.PreToolUse.some((g) => g.matcher === 'Bash'), 'the project\'s own guards are kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update ends with a setup check and the commit reminder', () => {
  const { dir, target } = project();
  try {
    const src = join(dir, 'starter');
    mkdirSync(src, { recursive: true });
    execFileSync(process.execPath, ['-e', `require('fs').cpSync(${JSON.stringify(join(ROOT, 'template'))}, ${JSON.stringify(join(src, 'template'))}, { recursive: true })`]);
    writeFileSync(join(src, 'VERSION'), '9.9.9\n');
    const gate = join(src, 'template', 'scripts', 'gate.sh');
    writeFileSync(gate, `${readFileSync(gate, 'utf8')}\n# starter change\n`);
    const r = cli(['update', target, '--source', src]);
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, out);
    assert.match(out, /Setup check \(problems only\)/);
    assert.match(out, /Commit these changes so sessions in git worktrees/);
    assert.match(out, /git add -A && git commit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('init --mod with no claude CLI still finishes and prints the install commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'init-noclaude-'));
  try {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
    env.PATH = dirname(process.execPath); // node only: `claude` cannot be found
    const r = spawnSync(process.execPath, [BIN, 'init', join(dir, 'p'), '--source', ROOT, '--no-prompt', '--mod'], { encoding: 'utf8', env });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, out);
    assert.ok(!/DeprecationWarning/.test(out), 'no Node deprecation warning');
    assert.equal((out.match(/claude plugin marketplace add/g) || []).length, 1, 'the install commands are printed once');
    assert.match(out, /Installing the starter-hud mod/);
    assert.match(out, /`claude` CLI was not found/);
    assert.match(out, /claude plugin marketplace add olavomello\/ai-project-starter#/);
    assert.match(out, /claude plugin install starter-hud@ai-project-starter --scope project/);
    assert.equal(settingsOf(join(dir, 'p')).enabledPlugins[MOD_ID], true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a git worktree whose branch predates the mod settings is flagged, with the fix', () => {
  const { dir, target } = project();
  try {
    git(target, 'config', 'user.email', 't@e.com');
    git(target, 'config', 'user.name', 'T');
    const wt = join(dir, 'wt-old');
    git(target, 'worktree', 'add', '-q', '-b', 'claude/old-branch', wt); // cut before the mod is enabled
    const s = settingsOf(target);
    s.enabledPlugins = { [MOD_ID]: true };
    s.extraKnownMarketplaces = { 'ai-project-starter': { source: { source: 'github', repo: 'olavomello/ai-project-starter', ref: 'main' } } };
    writeSettings(target, s);
    git(target, 'add', '-A');
    git(target, 'commit', '-q', '-m', 'enable the mod');
    const installed = () => ok(JSON.stringify([{ id: MOD_ID, enabled: true }]));
    const warns = checkSetup(target, { run: installed }).filter((f) => f.level === 'warn');
    assert.equal(warns.length, 1, warns.map((w) => w.msg).join(' | '));
    assert.match(warns[0].msg, /not enabled in 1 git worktree \(wt-old\)/);
    assert.match(warns[0].fix, /git merge main/);
    git(wt, 'config', 'user.email', 't@e.com');
    git(wt, 'config', 'user.name', 'T');
    git(wt, 'merge', '-q', 'main'); // the worktree branch catches up
    assert.equal(checkSetup(target, { run: installed }).filter((f) => f.level === 'warn').length, 0);
  } finally {
    try { git(target, 'worktree', 'remove', '--force', join(dir, 'wt-old')); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
