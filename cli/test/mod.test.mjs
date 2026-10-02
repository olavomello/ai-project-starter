// Tests for ../../template/scripts/mod.mjs (the one implementation of the
// starter-hud on/off toggle). Node's built-in test runner — not shipped in
// the npm package (cli/package.json's "files" doesn't list "test").
//
// Run: node --test cli/test/mod.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enableMod, disableMod, statusOf, setModEnabled } from '../../template/scripts/mod.mjs';

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'mod-test-'));
  return dir;
}

test('status on a project with no settings file: not configured', () => {
  const dir = tmpProject();
  const status = statusOf(dir);
  assert.equal(status.enabled, null);
  assert.equal(status.source, null);
  rmSync(dir, { recursive: true, force: true });
});

test('enable on a missing settings.json creates it with the plugin and marketplace entries', () => {
  const dir = tmpProject();
  const status = enableMod(dir);
  assert.equal(status.enabled, true);
  assert.equal(status.source, 'project');
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.enabledPlugins['starter-hud@ai-project-starter'], true);
  assert.equal(settings.extraKnownMarketplaces['ai-project-starter'].source.repo, 'olavomello/ai-project-starter');
  assert.equal(settings.extraKnownMarketplaces['ai-project-starter'].source.source, 'github');
  // Default ref is "main" when there's no .ai-project-starter.json manifest.
  assert.equal(settings.extraKnownMarketplaces['ai-project-starter'].source.ref, 'main');
  rmSync(dir, { recursive: true, force: true });
});

test('enable on a settings.json with unrelated keys preserves them', () => {
  const dir = tmpProject();
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [] }, someOtherKey: 42 }, null, 2) + '\n');
  enableMod(dir);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.hooks, { PreToolUse: [] });
  assert.equal(settings.someOtherKey, 42);
  assert.equal(settings.enabledPlugins['starter-hud@ai-project-starter'], true);
  rmSync(dir, { recursive: true, force: true });
});

test('enable twice in a row is idempotent (byte-identical settings file)', () => {
  const dir = tmpProject();
  enableMod(dir);
  const first = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
  enableMod(dir);
  const second = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
  assert.equal(first, second);
  rmSync(dir, { recursive: true, force: true });
});

test('enable with --local writes settings.local.json instead, and status prefers it', () => {
  const dir = tmpProject();
  enableMod(dir, { local: true });
  const localPath = join(dir, '.claude', 'settings.local.json');
  const projectPath = join(dir, '.claude', 'settings.json');
  assert.equal(JSON.parse(readFileSync(localPath, 'utf8')).enabledPlugins['starter-hud@ai-project-starter'], true);
  const status = statusOf(dir);
  assert.equal(status.source, 'local');
  assert.equal(status.enabled, true);
  // Project settings file was never created.
  assert.throws(() => readFileSync(projectPath, 'utf8'));
  rmSync(dir, { recursive: true, force: true });
});

test('enable with --ref pins the marketplace to that ref', () => {
  const dir = tmpProject();
  const status = enableMod(dir, { ref: 'v0.9.0' });
  assert.equal(status.ref, 'v0.9.0');
  rmSync(dir, { recursive: true, force: true });
});

test('disable sets enabledPlugins to false but leaves the marketplace entry in place', () => {
  const dir = tmpProject();
  enableMod(dir, { ref: 'v1.0.0' });
  const status = disableMod(dir);
  assert.equal(status.enabled, false);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.enabledPlugins['starter-hud@ai-project-starter'], false);
  assert.equal(settings.extraKnownMarketplaces['ai-project-starter'].source.ref, 'v1.0.0');
  rmSync(dir, { recursive: true, force: true });
});

test('invalid JSON in the existing settings file is refused, not overwritten', () => {
  const dir = tmpProject();
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), '{ this is not json');
  assert.throws(() => enableMod(dir), /not valid JSON/);
  // The file is untouched.
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), '{ this is not json');
  rmSync(dir, { recursive: true, force: true });
});

test('status --json shape: enable then read back via statusOf matches the documented fields', () => {
  const dir = tmpProject();
  setModEnabled(dir, true, { ref: 'main' });
  const status = statusOf(dir);
  assert.deepEqual(Object.keys(status).sort(), ['enabled', 'path', 'ref', 'source'].sort());
  rmSync(dir, { recursive: true, force: true });
});

test('ref respects the .ai-project-starter.json manifest when present and no --ref given', () => {
  const dir = tmpProject();
  writeFileSync(join(dir, '.ai-project-starter.json'), JSON.stringify({ starterVersion: '0.1.0' }));
  const status = enableMod(dir);
  assert.equal(status.ref, 'v0.1.0');
  rmSync(dir, { recursive: true, force: true });
});
