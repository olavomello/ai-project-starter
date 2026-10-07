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

// ---- dashboard hint when no tokens were recorded ----
import vm from 'node:vm';

test('the dashboard explains zero tokens instead of leaving the tiles blank', () => {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('function noUsageNote(d) {');
  const end = html.indexOf('\nfunction render(d) {', start);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const note = vm.runInNewContext(`${html.slice(start, end)}; noUsageNote`, { esc });
  const none = note({ log_records: 43, totals: { tokens_in: 0, cache_read: 0 } });
  assert.ok(none.includes('No token usage has been recorded yet'));
  assert.ok(none.includes('43 runs') && none.includes('mod.mjs status') && none.includes('.agents/state/usage/'));
  assert.equal(note({ log_records: 43, totals: { tokens_in: 1200, cache_read: 0 } }), '');
  assert.equal(note({ log_records: 0, totals: { tokens_in: 0, cache_read: 0 } }), '');
});

// ---- permission deny rules ----
test('the template denies secrets to Claude Code and keeps the example env readable', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, 'template', '.claude', 'settings.json'), 'utf8'));
  const deny = settings.permissions.deny;
  for (const rule of ['Read(.env)', 'Read(.env.*)', 'Read(!.env.example)', 'Read(secrets/**)', 'Read(*.pem)', 'Read(*.key)']) assert.ok(deny.includes(rule), rule);
  assert.ok(deny.indexOf('Read(!.env.example)') > deny.indexOf('Read(.env.*)'), 'the negation comes after the rule it carves out');
  assert.ok(!deny.some((r) => /node_modules|dist|png|pdf|svg/.test(r)), 'noise is handled by .gitignore, not hidden from the agent');
  assert.ok(!existsSync(join(ROOT, 'template', '.claudeignore')), 'Claude Code ignores .claudeignore, so the template does not ship one');
});

test('the template .gitignore covers dependencies and build output without hiding vendored code', () => {
  const lines = readFileSync(join(ROOT, 'template', '.gitignore'), 'utf8').split(/\r?\n/);
  for (const entry of ['node_modules/', 'dist/', '.next/', 'coverage/', '*.log', '.env', '!.env.example', '*.pem']) assert.ok(lines.includes(entry), entry);
  assert.ok(!lines.includes('vendor/') && !lines.includes('*.svg') && !lines.includes('*.png'));
});

test('mergeSettings appends missing starter deny rules in order and keeps the project\'s own', () => {
  const incoming = JSON.stringify({ permissions: { deny: ['Read(.env)', 'Read(.env.*)', 'Read(!.env.example)'] } });
  const local = JSON.stringify({ permissions: { allow: ['Bash(pnpm test)'], deny: ['Read(.env)', 'Read(mine/**)'] } });
  const { text, added } = mergeSettings(local, incoming);
  const out = JSON.parse(text);
  assert.deepEqual(added, ['deny: Read(.env.*)', 'deny: Read(!.env.example)']);
  assert.deepEqual(out.permissions.deny, ['Read(.env)', 'Read(mine/**)', 'Read(.env.*)', 'Read(!.env.example)']);
  assert.deepEqual(out.permissions.allow, ['Bash(pnpm test)']);
  assert.deepEqual(mergeSettings(text, incoming).added, [], 'idempotent');
  assert.deepEqual(JSON.parse(mergeSettings('{}', incoming).text).permissions.deny, ['Read(.env)', 'Read(.env.*)', 'Read(!.env.example)']);
});

// ---- marketplace pin repair ----
import { fixModPin } from '../src/lib/settings-merge.js';

const withPin = (ref, repo = 'olavomello/ai-project-starter') => JSON.stringify({
  enabledPlugins: { 'starter-hud@ai-project-starter': true },
  extraKnownMarketplaces: { 'ai-project-starter': { source: { source: 'github', repo, ref } } },
});

test('a starter-hud pin to a tag that predates the mod is moved to main; other pins are left alone', () => {
  for (const ref of ['v0.1.0', 'v0.0.1', 'v0.1.0-rc1']) {
    const { text, change } = fixModPin(withPin(ref));
    assert.equal(JSON.parse(text).extraKnownMarketplaces['ai-project-starter'].source.ref, 'main', ref);
    assert.match(change, /v0\.[01]\.[01].* -> main/);
  }
  for (const ref of ['main', 'v0.1.1', 'v0.2.0', 'v1.0.0', 'feature/x']) assert.equal(fixModPin(withPin(ref)).text, null, ref);
  assert.equal(fixModPin(withPin('v0.1.0', 'someone/else')).text, null, 'only the starter marketplace');
  assert.equal(fixModPin('{ nope').text, null);
  assert.deepEqual(JSON.parse(fixModPin(withPin('v0.1.0')).text).enabledPlugins, { 'starter-hud@ai-project-starter': true });
});

test('update repairs the bad pin even when the starter did not change settings.json', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const src = fakeStarter(dir);
    assert.equal(cli('init', target, '--source', src, '--no-prompt').status, 0);
    const settingsPath = join(target, '.claude', 'settings.json');
    const mine = JSON.parse(readFileSync(settingsPath, 'utf8'));
    Object.assign(mine, JSON.parse(withPin('v0.1.0')));            // what the old `mod enable` wrote
    writeFileSync(settingsPath, JSON.stringify(mine, null, 2));
    const dry = cli('update', target, '--source', src, '--dry-run');
    assert.match(dry.stdout + dry.stderr, /marketplace ref: v0\.1\.0 -> main/);
    assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).extraKnownMarketplaces['ai-project-starter'].source.ref, 'v0.1.0', 'dry run writes nothing');
    assert.equal(cli('update', target, '--source', src).status, 0);
    const fixed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(fixed.extraKnownMarketplaces['ai-project-starter'].source.ref, 'main');
    assert.deepEqual(fixed.hooks, mine.hooks, 'the project\'s hooks are untouched');
    assert.ok(!/marketplace ref/.test(cli('update', target, '--source', src, '--dry-run').stdout), 'nothing left to repair');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- charts with and without token data ----
function loadCharts() {
  const html = readFileSync(join(ROOT, 'template', 'ai-dash', 'index.html'), 'utf8');
  const start = html.indexOf('function lineChart(days) {');
  const end = html.indexOf('function agentTable(d) {');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (n == null ? '-' : n.toLocaleString());
  const pct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');
  const kilo = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  const SERIES = ['a', 'b', 'c', 'd', 'e'];
  return vm.runInNewContext(`${html.slice(start, end)}; ({ lineChart, shareBar })`, { esc, fmt, pct, kilo, SERIES, Math, Number, String });
}
const day = (day, executions, tokens_in = 0, cache_read = 0) => ({ day, executions, tokens_in, cache_read });

test('with no token data the trend charts gate executions per day instead of a flat zero line', () => {
  const { lineChart } = loadCharts();
  const html = lineChart([day('2026-10-06', 45), day('2026-10-07', 25)]);
  assert.ok(html.includes('Executions per day') && !html.includes('Tokens per day'));
  assert.ok(html.includes('gate runs') && html.includes('45 execution(s)') && html.includes('no token usage recorded yet'));
  assert.ok(html.includes('<path'), 'a line is drawn');
  const withTokens = lineChart([day('2026-10-06', 3, 1200, 900), day('2026-10-07', 2, 800, 700)]);
  assert.ok(withTokens.includes('Tokens per day') && withTokens.includes('cached') && !withTokens.includes('Executions per day'));
  assert.ok(lineChart([day('2026-10-06', 5)]).includes('Needs at least two days'));
});

test('with no token data the breakdown bars share executions, with tokens they share tokens', () => {
  const { shareBar } = loadCharts();
  const rows = (t) => [
    { task_type: 'other', executions: 67, tokens_in: t[0], gate_first_pass: 0.4 },
    { task_type: 'build-feature', executions: 2, tokens_in: t[1], gate_first_pass: 0.5 },
    { task_type: 'fix-bug', executions: 1, tokens_in: t[2], gate_first_pass: 0 },
  ];
  const none = shareBar(rows([0, 0, 0]), 'task_type', 'Tokens by task type');
  assert.ok(none.includes('Executions by task type') && !none.includes('Tokens by task type'));
  assert.ok(none.includes('>96%<') && none.includes('>3%<') && none.includes('>1%<'), 'shares of 67/70, 2/70 and 1/70');
  assert.ok(none.includes('of executions'));
  const some = shareBar(rows([9000, 900, 100]), 'task_type', 'Tokens by task type');
  assert.ok(some.includes('Tokens by task type') && some.includes('>90%<') && some.includes('of tokens'));
  assert.equal(shareBar([], 'model', 'Tokens by model'), '');
});
