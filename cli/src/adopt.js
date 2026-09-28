// Registers an existing project (created by the old bash init-project.sh,
// or by hand) so `update` can track it. Baseline = the project's files as
// they are right now, against the starter ref you tell it (or `main` if
// you don't know — update will then diff from main's current state, which
// is the safest default when the true origin is unknown).
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { existsSync } from './lib/fsutil.js';
import { resolveSource } from './lib/source.js';
import { buildFileHashes, newManifest, writeManifest, MANIFEST_FILE } from './lib/manifest.js';
import { die, info, section } from './lib/log.js';

export function adopt({ target = '.', ref = 'main', source, force = false }) {
  if (!existsSync(join(target, 'AGENTS.md'))) {
    die(`${target} has no AGENTS.md — doesn't look like an ai-project-starter project.`);
  }
  if (existsSync(join(target, MANIFEST_FILE)) && !force) {
    die(`${target} already has ${MANIFEST_FILE}. Pass --force to rebuild its baseline.`);
  }

  section(`Adopting ${target} against starter ref "${ref}"...`);
  const { starterVersion, starterRef, cleanup } = resolveSource({ source, ref });
  cleanup();

  // Baseline hashes come from the PROJECT's own current files, not the
  // fetched template — adopt records "this is what we have today", so the
  // next `update` compares against what actually changed from here on,
  // rather than pretending the project already matched a specific release.
  const files = buildFileHashes(target);
  delete files[MANIFEST_FILE];
  writeManifest(target, newManifest({ starterVersion: `${starterVersion} (adopted baseline)`, starterRef, files }));

  info(`Wrote ${MANIFEST_FILE}. \`ai-project-starter update\` will now diff against starter ref "${ref}" going forward.`);
}
