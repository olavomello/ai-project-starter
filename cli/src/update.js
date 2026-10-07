// Pulls starter improvements into an already-created project. No merge
// magic: a file only changes automatically when the PROJECT never touched
// it since the last sync. Anything the project customized, and anything
// the starter changed on the same file at the same time, is left alone —
// flagged, with the incoming version written next to it as `<file>.incoming`
// for you to review and merge by hand.
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, rmSync as rmFile, mkdirSync } from 'node:fs';
import { existsSync, hashFile, isFile } from './lib/fsutil.js';
import { resolveSource } from './lib/source.js';
import { buildFileHashes, readManifest, writeManifest, newManifest, isProtected, isIgnored, MANIFEST_FILE } from './lib/manifest.js';
import { mergeSettings, fixModPin } from './lib/settings-merge.js';
import { runDoctor } from './doctor.js';
import { COMMIT_HINT } from './lib/setup-check.js';
import { die, info, ok, warn, section } from './lib/log.js';

const SETTINGS_FILE = '.claude/settings.json';

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

    const applied = [], added = [], removed = [], conflicts = [], protectedChanged = [], upToDate = [], merged = [];
    const newFiles = { ...manifest.files };
    // Protected files: the starter hash a project has already been told about. A
    // changed protected file is reported once per starter change, not on every run.
    const acknowledged = { ...manifest.acknowledged };

    for (const rel of allPaths) {
      const baseline = manifest.files?.[rel];
      const newHash = incoming[rel];
      const localExists = existsSync(join(target, rel));
      if (isIgnored(rel)) { delete newFiles[rel]; continue; }
      if (localExists && !isFile(join(target, rel))) continue; // a directory or link where the starter has a file: not ours to touch
      const localHash = localExists ? hashFile(join(target, rel)) : undefined;

      // Already identical to the starter's copy (e.g. a half-finished earlier run wrote
      // it, or it was merged by hand): nothing to do, whatever the recorded baseline says.
      if (newHash !== undefined && localHash === newHash) {
        if (!isProtected(rel)) { newFiles[rel] = newHash; upToDate.push(rel); }
        continue;
      }

      if (isProtected(rel)) {
        if (newHash && newHash !== baseline && acknowledged[rel] !== newHash) {
          protectedChanged.push(rel);
          acknowledged[rel] = newHash;
        }
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
        // Local customization, starter unchanged — keep local. The baseline stays the
        // starter's last-synced copy; recording the local hash instead would turn this
        // file into a false conflict at the next update.
        if (rel === SETTINGS_FILE) {
          const { text, change } = fixModPin(readFileSync(join(target, rel), 'utf8'));
          if (text !== null) {
            merged.push({ file: rel, hooks: [change] });
            if (!dryRun) writeFileSync(join(target, rel), text);
          }
        }
        continue;
      }
      // Both changed. The project's settings.json is edited by the session-mod toggle,
      // so rather than flagging it every time, merge the starter's hooks into it.
      if (rel === SETTINGS_FILE) {
        const { text, added: hooks } = mergeSettings(readFileSync(join(target, rel), 'utf8'), readFileSync(join(templateDir, rel), 'utf8'));
        if (text !== null) {
          if (hooks.length) {
            merged.push({ file: rel, hooks });
            if (!dryRun) writeFileSync(join(target, rel), text);
          } else upToDate.push(rel);
          newFiles[rel] = newHash;
          continue;
        }
      }
      // Both changed: conflict.
      conflicts.push(rel);
      if (!dryRun) writeFile(join(target, `${rel}.incoming`), join(templateDir, rel));
    }

    report({ applied, added, removed, conflicts, protectedChanged, upToDate, merged, dryRun });

    if (!dryRun) {
      writeManifest(target, {
        ...manifest,
        starterVersion,
        starterRef,
        updatedAt: new Date().toISOString(),
        files: newFiles,
        acknowledged,
      });
      info(`\nWrote ${MANIFEST_FILE} (now tracking v${starterVersion}).`);
      afterUpdate(target, applied.length + added.length + merged.length);
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

function report({ applied, added, removed, conflicts, protectedChanged, upToDate, merged, dryRun }) {
  const verb = dryRun ? 'would update' : 'updated';
  if (applied.length) { section(`Auto-${verb} (untouched locally):`); applied.forEach((f) => ok(f)); }
  if (added.length) { section('New in the starter, added:'); added.forEach((f) => ok(f)); }
  if (merged.length) {
    section(`Your customized file got the starter's hooks ${dryRun ? '(would be added; the rest of the file is kept as is)' : 'added (the rest of the file is kept as is)'}:`);
    for (const m of merged) { ok(m.file); m.hooks.forEach((h) => info(`    + ${h}`)); }
  }
  if (removed.length) { section('Dropped by the starter, removed (were untouched locally):'); removed.forEach((f) => ok(f)); }
  if (conflicts.length) {
    section('Conflicts — you changed it AND the starter changed it. Left as-is:');
    conflicts.forEach((f) => warn(`${f}  (incoming version: ${f}.incoming — review with \`git diff --no-index ${f} ${f}.incoming\`, then delete the .incoming file)`));
  }
  if (protectedChanged.length) {
    section('Starter changed these, but they\'re yours to customize — review manually, check CHANGELOG.md (listed once per starter change):');
    protectedChanged.forEach((f) => warn(f));
  }
  section(`Unchanged: ${upToDate.length} file(s).`);
}

/** The setup check after an update, so a half-applied chain is named now and not found later as an empty panel. */
function afterUpdate(target, touched) {
  section('Setup check (problems only):');
  const report = {};
  runDoctor(target, { quiet: false, onlyProblems: true, report });
  if (!report.warnings) ok('nothing to fix');
  else info('Run `ai-project-starter doctor --fix` to repair what can be repaired.');
  if (touched) info(`\nCommit these changes so sessions in git worktrees (such as the desktop app's) get them:\n  ${COMMIT_HINT}`);
}
