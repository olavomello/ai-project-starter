#!/usr/bin/env node
// Builds latest.json and SHA256SUMS for a desktop release from the binaries the CI built.
//
//   node desktop/scripts/make-latest.mjs --dir dist --tag desktop-v0.1.0 --repo olavomello/ai-project-starter
//
// Looks in --dir for ai-dash-desktop-<target>.exe (Windows) or ai-dash-desktop-<target>.tar.gz (macOS), writes
// latest.json (the file scripts/ai-dash-app.mjs reads: version, and per target the name, URL, size and SHA-256)
// and SHA256SUMS next to them. Dependency-free Node, so the release job needs nothing installed.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TAG_PREFIX = 'desktop-v';
const ASSET = /^ai-dash-desktop-(win-x64|mac-arm64|mac-x64)\.(exe|tar\.gz)$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** latest.json content for the binaries in `dir`. Throws when there is nothing to publish or the tag is wrong. */
export function buildLatest({ dir, tag, repo }) {
  if (!tag.startsWith(TAG_PREFIX) || !SEMVER.test(tag.slice(TAG_PREFIX.length))) throw new Error(`tag must look like ${TAG_PREFIX}1.2.3, got "${tag}"`);
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`repo must be owner/name, got "${repo}"`);
  const version = tag.slice(TAG_PREFIX.length);
  const assets = {};
  const sums = [];
  for (const name of readdirSync(dir).sort()) {
    const m = ASSET.exec(name);
    if (!m) continue;
    const bytes = readFileSync(join(dir, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assets[m[1]] = { name, url: `https://github.com/${repo}/releases/download/${tag}/${name}`, sha256, size: statSync(join(dir, name)).size };
    sums.push(`${sha256}  ${name}`);
  }
  if (!Object.keys(assets).length) throw new Error(`no ai-dash-desktop-<target> files in ${dir}`);
  return { latest: { version, assets }, sums: `${sums.join('\n')}\n` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  try {
    const dir = arg('--dir');
    const tag = arg('--tag');
    const repo = arg('--repo');
    if (!dir || !tag || !repo) throw new Error('usage: make-latest.mjs --dir <folder> --tag desktop-vX.Y.Z --repo owner/name');
    const { latest, sums } = buildLatest({ dir, tag, repo });
    writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
    writeFileSync(join(dir, 'SHA256SUMS'), sums);
    console.log(`latest.json for ${latest.version}: ${Object.keys(latest.assets).join(', ')}`);
  } catch (e) {
    console.error(`make-latest: ${e.message}`);
    process.exit(1);
  }
}
