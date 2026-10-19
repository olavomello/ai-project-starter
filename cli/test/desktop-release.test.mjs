// Tests for the release side of the desktop shell: latest.json made by the CI is what the launcher accepts,
// and a tag can only ship the version that is in Cargo.toml.
//
// Run: node --test cli/test/desktop-release.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLatest } from '../../desktop/scripts/make-latest.mjs';
import { cargoVersion, checkTag } from '../../desktop/scripts/check-version.mjs';
import { validateLatest, pickRelease } from '../../template/scripts/ai-dash-app.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const REPO = 'olavomello/ai-project-starter';

test('latest.json from make-latest is exactly what the launcher validates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-release-'));
  try {
    writeFileSync(join(dir, 'ai-dash-desktop-win-x64.exe'), 'win-bytes');
    writeFileSync(join(dir, 'ai-dash-desktop-mac-arm64.tar.gz'), 'mac-arm-bytes');
    writeFileSync(join(dir, 'ai-dash-desktop-mac-x64.tar.gz'), 'mac-x64-bytes');
    writeFileSync(join(dir, 'notes.txt'), 'not a binary');
    const { latest, sums } = buildLatest({ dir, tag: 'desktop-v0.1.0', repo: REPO });
    assert.equal(latest.version, '0.1.0');
    assert.deepEqual(Object.keys(latest.assets).sort(), ['mac-arm64', 'mac-x64', 'win-x64']);
    const prefix = `https://github.com/${REPO}/releases/download/`;
    const win = validateLatest(latest, 'win-x64', prefix);
    assert.equal(win.url, `${prefix}desktop-v0.1.0/ai-dash-desktop-win-x64.exe`);
    assert.equal(win.sha256, sha('win-bytes'));
    assert.equal(win.size, 'win-bytes'.length);
    assert.equal(validateLatest(latest, 'mac-arm64', prefix).name, 'ai-dash-desktop-mac-arm64.tar.gz');
    assert.match(sums, new RegExp(`^${sha('win-bytes')}  ai-dash-desktop-win-x64\\.exe$`, 'm'));
    // and the release listing the CI creates is one the launcher picks
    assert.equal(pickRelease([{ tag_name: 'desktop-v0.1.0', draft: false, prerelease: false, assets: [{ name: 'latest.json', browser_download_url: `${prefix}desktop-v0.1.0/latest.json` }] }]).version, '0.1.0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('make-latest refuses a bad tag, a bad repo and an empty folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-release-'));
  try {
    writeFileSync(join(dir, 'ai-dash-desktop-win-x64.exe'), 'x');
    assert.throws(() => buildLatest({ dir, tag: 'v0.1.0', repo: REPO }), /tag must look like/);
    assert.throws(() => buildLatest({ dir, tag: 'desktop-v1.2', repo: REPO }), /tag must look like/);
    assert.throws(() => buildLatest({ dir, tag: 'desktop-v0.1.0', repo: 'not a repo' }), /owner\/name/);
    const empty = mkdtempSync(join(tmpdir(), 'desktop-empty-'));
    try { assert.throws(() => buildLatest({ dir: empty, tag: 'desktop-v0.1.0', repo: REPO }), /no ai-dash-desktop/); } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI writes latest.json and SHA256SUMS next to the binaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-release-'));
  try {
    writeFileSync(join(dir, 'ai-dash-desktop-win-x64.exe'), 'exe');
    const r = spawnSync(process.execPath, [join(ROOT, 'desktop', 'scripts', 'make-latest.mjs'), '--dir', dir, '--tag', 'desktop-v0.2.0', '--repo', REPO], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).version, '0.2.0');
    assert.match(readFileSync(join(dir, 'SHA256SUMS'), 'utf8'), /ai-dash-desktop-win-x64\.exe/);
    assert.equal(spawnSync(process.execPath, [join(ROOT, 'desktop', 'scripts', 'make-latest.mjs'), '--dir', dir], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a tag can only ship the version that is in Cargo.toml', () => {
  const cargo = readFileSync(join(ROOT, 'desktop', 'Cargo.toml'), 'utf8');
  const version = cargoVersion(cargo);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(checkTag(`desktop-v${version}`, cargo), version);
  assert.throws(() => checkTag('desktop-v9.9.9', cargo), /does not match/);
  assert.throws(() => checkTag(`v${version}`, cargo), /does not match/);
  assert.equal(cargoVersion('[dependencies]\nserde = "1.0.0"\n[package]\nname = "x"\nversion = "2.3.4"\n[profile.release]\nversion = "9.9.9"'), '2.3.4');
  assert.equal(cargoVersion('[dependencies]\nversion = "1.0.0"'), null);
});
