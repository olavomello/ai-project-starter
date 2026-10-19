#!/usr/bin/env node
// Fails unless the release tag matches the version in desktop/Cargo.toml, so a binary never ships under another
// version than the one it reports about itself.
//
//   node desktop/scripts/check-version.mjs desktop-v0.1.0
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The `version = "x.y.z"` of the [package] table of a Cargo.toml text, or null. */
export function cargoVersion(text) {
  const pkg = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  const m = pkg && /^version\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(pkg[1]);
  return m ? m[1] : null;
}

export function checkTag(tag, cargoText) {
  const version = cargoVersion(cargoText);
  if (!version) throw new Error('no package version found in Cargo.toml');
  if (tag !== `desktop-v${version}`) throw new Error(`tag ${tag} does not match Cargo.toml version ${version} (expected desktop-v${version})`);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cargo = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Cargo.toml'), 'utf8');
    console.log(`version ${checkTag(process.argv[2] || '', cargo)} matches the tag`);
  } catch (e) {
    console.error(`check-version: ${e.message}`);
    process.exit(1);
  }
}
