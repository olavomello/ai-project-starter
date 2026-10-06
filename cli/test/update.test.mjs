// Tests for walk() and for `update` on a project that has links or a
// node_modules tree (regression: EISDIR on a Windows junction). Node's
// built-in test runner.
//
// Run: node --test cli/test/update.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk } from '../src/lib/fsutil.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = join(ROOT, 'cli', 'bin.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'update-test-'));
const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

function tryLink(target, path) {
  try { symlinkSync(target, path, 'junction'); return true; } catch { return false; }
}

test('walk lists regular files only: no links, no node_modules, no .git', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.js'), 'a');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), 'i');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'h');
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'f.txt'), 'f');
    const linked = tryLink(join(dir, 'real'), join(dir, 'link'));
    const files = walk(dir).sort();
    assert.deepEqual(files, ['real/f.txt', 'src/a.js']);
    if (!linked) console.log('# (could not create a link on this system; the link case was not exercised)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update works on a project containing a directory link and a node_modules tree', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const init = cli('init', target, '--source', ROOT, '--no-prompt');
    assert.equal(init.status, 0, init.stderr);
    mkdirSync(join(target, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(target, 'node_modules', 'pkg', 'index.js'), 'x');
    mkdirSync(join(target, 'shared'));
    tryLink(join(target, 'shared'), join(target, 'shared-link'));
    const before = readFileSync(join(target, '.ai-project-starter.json'), 'utf8');
    const out = cli('update', target, '--source', ROOT, '--dry-run');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(join(target, '.ai-project-starter.json'), 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- baseline handling ----
import { cpSync } from 'node:fs';

/** A throwaway "starter checkout": template/ copied from this repo plus a VERSION. */
function fakeStarter(dir) {
  const src = join(dir, 'starter');
  cpSync(join(ROOT, 'template'), join(src, 'template'), { recursive: true });
  writeFileSync(join(src, 'VERSION'), '9.9.9\n');
  return src;
}
const manifestOf = (target) => JSON.parse(readFileSync(join(target, '.ai-project-starter.json'), 'utf8'));
const writeManifestOf = (target, m) => writeFileSync(join(target, '.ai-project-starter.json'), JSON.stringify(m, null, 2));

test('a file already identical to the starter is not a conflict, even with a stale baseline', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    // Simulate a half-finished earlier update: content matches the starter, baseline is old.
    const m = manifestOf(target);
    m.files['scripts/agents-sync.mjs'] = 'sha256:stale';
    writeManifestOf(target, m);
    const out = cli('update', target, '--source', src);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(!/Conflicts/.test(out.stdout + out.stderr), out.stdout + out.stderr);
    assert.ok(!existsSync(join(target, 'scripts', 'agents-sync.mjs.incoming')));
    assert.notEqual(manifestOf(target).files['scripts/agents-sync.mjs'], 'sha256:stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('keeping a local customization does not move the baseline (no false conflict next time)', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    const before = manifestOf(target).files['scripts/gate.sh'];
    writeFileSync(join(target, 'scripts', 'gate.sh'), readFileSync(join(target, 'scripts', 'gate.sh'), 'utf8') + '\n# local tweak\n');
    assert.equal(cli('update', target, '--source', src).status, 0);
    assert.equal(manifestOf(target).files['scripts/gate.sh'], before);
    // Starter now changes the same file -> a real conflict, reported once.
    writeFileSync(join(src, 'template', 'scripts', 'gate.sh'), readFileSync(join(src, 'template', 'scripts', 'gate.sh'), 'utf8') + '\n# starter change\n');
    const out = cli('update', target, '--source', src, '--dry-run');
    assert.match(out.stdout, /Conflicts/);
    assert.match(out.stdout + out.stderr, /scripts\/gate\.sh/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ai-dash/data.json is runtime output: never tracked, never reported', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    assert.equal(manifestOf(target).files['ai-dash/data.json'], undefined);
    writeFileSync(join(target, 'ai-dash', 'data.json'), '{"runs": 3}');
    writeFileSync(join(src, 'template', 'ai-dash', 'data.json'), '{"runs": 0, "seed": true}');
    const out = cli('update', target, '--source', src, '--dry-run');
    assert.equal(out.status, 0, out.stderr);
    assert.ok(!(out.stdout + out.stderr).includes('ai-dash/data.json'), out.stdout + out.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a changed protected file is reported once per starter change, and a dry run does not count', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    const agents = join(src, 'template', 'AGENTS.md');
    const reported = (r) => (r.stdout + r.stderr).includes('AGENTS.md');
    const bump = (text) => writeFileSync(agents, readFileSync(agents, 'utf8') + `\n${text}\n`);

    bump('change one');
    assert.ok(reported(cli('update', target, '--source', src, '--dry-run')), 'dry run reports it');
    assert.ok(reported(cli('update', target, '--source', src, '--dry-run')), 'a dry run does not mark it as seen');
    assert.ok(reported(cli('update', target, '--source', src)), 'the real run reports it');
    assert.ok(!reported(cli('update', target, '--source', src)), 'then it stays quiet');
    assert.ok(!reported(cli('update', target, '--source', src, '--dry-run')));

    bump('change two');
    assert.ok(reported(cli('update', target, '--source', src)), 'a new starter change is reported again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- settings.json hook merge ----
import { mergeSettings } from '../src/lib/settings-merge.js';

const HOOK = (cmd) => ({ type: 'command', command: cmd });

test('mergeSettings adds missing starter hooks and keeps everything else', () => {
  const local = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [HOOK('mine.sh')] }] },
    enabledPlugins: { 'starter-hud@x': true },
    extraKnownMarketplaces: { x: { source: 'github' } },
  });
  const incoming = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [HOOK('mine.sh'), HOOK('block.sh')] }],
      SubagentStart: [{ hooks: [HOOK('node live start')] }],
    },
  });
  const { text, added } = mergeSettings(local, incoming);
  const out = JSON.parse(text);
  assert.deepEqual(added, ['PreToolUse: block.sh', 'SubagentStart: node live start']);
  assert.deepEqual(out.hooks.PreToolUse[0].hooks.map((h) => h.command), ['mine.sh', 'block.sh']);
  assert.equal(out.hooks.SubagentStart[0].hooks[0].command, 'node live start');
  assert.deepEqual(out.enabledPlugins, { 'starter-hud@x': true });
  assert.deepEqual(out.extraKnownMarketplaces, { x: { source: 'github' } });
  assert.ok(text.endsWith('\n'));
});

test('mergeSettings is idempotent and reports invalid JSON as null', () => {
  const incoming = JSON.stringify({ hooks: { SubagentStop: [{ hooks: [HOOK('node live stop')] }] } });
  const once = mergeSettings('{}', incoming);
  const twice = mergeSettings(once.text, incoming);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.text, once.text);
  assert.equal(mergeSettings('{ nope', incoming).text, null);
  assert.equal(mergeSettings('[]', incoming).text, null);
});

test('update merges new starter hooks into a customized settings.json instead of conflicting', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    const settingsPath = join(target, '.claude', 'settings.json');
    const mine = JSON.parse(readFileSync(settingsPath, 'utf8'));
    mine.enabledPlugins = { 'starter-hud@ai-project-starter': true };   // what the mod toggle does
    writeFileSync(settingsPath, JSON.stringify(mine, null, 2));
    const tplPath = join(src, 'template', '.claude', 'settings.json');
    const tpl = JSON.parse(readFileSync(tplPath, 'utf8'));
    tpl.hooks.SessionStart = [{ hooks: [HOOK('node scripts/new-hook.mjs')] }];
    writeFileSync(tplPath, JSON.stringify(tpl, null, 2));

    const dry = cli('update', target, '--source', src, '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout + dry.stderr, /SessionStart: node scripts\/new-hook\.mjs/);
    assert.ok(!JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.SessionStart, 'dry run writes nothing');

    const real = cli('update', target, '--source', src);
    assert.equal(real.status, 0, real.stderr);
    assert.ok(!/Conflicts/.test(real.stdout + real.stderr));
    assert.ok(!existsSync(settingsPath + '.incoming'));
    const merged = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(merged.hooks.SessionStart[0].hooks[0].command, 'node scripts/new-hook.mjs');
    assert.deepEqual(merged.enabledPlugins, { 'starter-hud@ai-project-starter': true });

    const again = cli('update', target, '--source', src, '--dry-run');
    assert.ok(!/new-hook/.test(again.stdout + again.stderr), 'nothing left to merge on the next run');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
