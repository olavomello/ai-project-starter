// Pulls starter improvements into an already-created project. No merge
// magic: a file only changes automatically when the PROJECT never touched
// it since the last sync. Anything the project customized, and anything
// the starter changed on the same file at the same time, is left alone —
// flagged, with the incoming version written next to it as `<file>.incoming`
// for you to review and merge by hand.
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, rmSync as rmFile, mkdirSync } from 'node:fs';
import { existsSync, hashFile } from './lib/fsutil.js';
import { resolveSource } from './lib/source.js';
import { buildFileHashes, readManifest, writeManifest, newManifest, isProtected, MANIFEST_FILE } from './lib/manifest.js';
import { die, info, ok, warn, section } from './lib/log.js';

export function update({ target = '.', ref = 'main', source, dryRun = false }) {
  const manifest = readManifest(target);
  if (!manifest) {
    die(`no ${MANIFEST_FILE} in ${target} — run \`ai-project-starter adopt\` first (for a project created before the CLI existed).`);
  }

  section(`Checking ai-project-starter#${ref} against your last sync (v${manifest.starterVersion})...`);
  const { templateDir, starterVersion, starterRef, cleanup } = resolveSource({ source, ref });

  try {
    const incoming = buildFileHashes(templateDir);
    // Only paths the manifest or the starter know about matter: a file that exists
    // only in the project is never touched, so there's no reason to walk (and hash)
    // the whole project tree, node_modules and all.
    const allPaths = new Set([...Object.keys(manifest.files || {}), ...Object.keys(incoming)]);

    const applied = [], added = [], removed = [], conflicts = [], protectedChanged = [], upToDate = [];
    const newFiles = { ...manifest.files };

    for (const rel of allPaths) {
      const baseline = manifest.files?.[rel];
      const newHash = incoming[rel];
      const localExists = existsSync(join(target, rel));
      const localHash = localExists ? hashFile(join(target, rel)) : undefined;

      if (isProtected(rel)) {
        if (newHash && newHash !== baseline) protectedChanged.push(rel);
        continue; // never touched automatically
      }

      if (newHash === undefined && localExists) {
        // Starter dropped this file.
        if (localHash === baseline) {
          removed.push(rel);
          if (!dryRun) rmFile(join(target, rel));
          delete newFiles[rel];
        } // else: locally modified, starter dropped it — leave it, don't touch newFiles
        continue;
      }

      if (newHash === undefined) continue; // nothing to do, not in either

      if (!localExists) {
        added.push(rel);
        if (!dryRun) writeFile(join(target, rel), join(templateDir, rel));
        newFiles[rel] = newHash;
        continue;
      }

      if (localHash === baseline && newHash === baseline) {
        upToDate.push(rel);
        continue;
      }
      if (localHash === baseline && newHash !== baseline) {
        applied.push(rel);
        if (!dryRun) writeFile(join(target, rel), join(templateDir, rel));
        newFiles[rel] = newHash;
        continue;
      }
      if (localHash !== baseline && newHash === baseline) {
        // Local customization, starter unchanged — keep local, adopt its hash as new baseline.
        newFiles[rel] = localHash;
        continue;
      }
      // Both changed: conflict.
      conflicts.push(rel);
      if (!dryRun) writeFile(join(target, `${rel}.incoming`), join(templateDir, rel));
    }

    report({ applied, added, removed, conflicts, protectedChanged, upToDate, dryRun });

    if (!dryRun) {
      writeManifest(target, {
        ...manifest,
        starterVersion,
        starterRef,
        updatedAt: new Date().toISOString(),
        files: newFiles,
      });
      info(`\nWrote ${MANIFEST_FILE} (now tracking v${starterVersion}).`);
    } else {
      info('\nDry run — nothing was written. Re-run without --dry-run to apply.');
    }
  } finally {
    cleanup();
  }
}

function writeFile(destPath, srcPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, readFileSync(srcPath));
}

function report({ applied, added, removed, conflicts, protectedChanged, upToDate, dryRun }) {
  const verb = dryRun ? 'would update' : 'updated';
  if (applied.length) { section(`Auto-${verb} (untouched locally):`); applied.forEach((f) => ok(f)); }
  if (added.length) { section('New in the starter, added:'); added.forEach((f) => ok(f)); }
  if (removed.length) { section('Dropped by the starter, removed (were untouched locally):'); removed.forEach((f) => ok(f)); }
  if (conflicts.length) {
    section('Conflicts — you changed it AND the starter changed it. Left as-is:');
    conflicts.forEach((f) => warn(`${f}  (incoming version: ${f}.incoming — review with \`git diff --no-index ${f} ${f}.incoming\`, then delete the .incoming file)`));
  }
  if (protectedChanged.length) {
    section('Starter changed these, but they\'re yours to customize — review manually, check CHANGELOG.md:');
    protectedChanged.forEach((f) => warn(f));
  }
  section(`Unchanged: ${upToDate.length} file(s).`);
}
