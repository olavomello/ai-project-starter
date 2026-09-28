import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import {
  existsSync, mkdirSync, copyTree, makeExecutable, isDir, walk,
} from './lib/fsutil.js';
import { gitAvailable, gitInit, gitAddAll, gitCommit } from './lib/exec.js';
import { resolveSource } from './lib/source.js';
import { buildFileHashes, newManifest, writeManifest } from './lib/manifest.js';
import { die, info, section, warn } from './lib/log.js';
import { runDoctor } from './doctor.js';

export function init({ target, ref = 'main', source }) {
  if (!target) die('usage: ai-project-starter init <target-dir> [--ref <branch-or-tag>] [--source <path-or-url>]');
  if (existsSync(target) && readdirSync(target).length > 0) {
    die(`target "${target}" exists and is not empty`);
  }

  section(`Fetching starter (${source || 'https://github.com/olavomello/ai-project-starter.git'}#${ref})...`);
  const { templateDir, starterVersion, starterRef, cleanup } = resolveSource({ source, ref });

  try {
    mkdirSync(target, { recursive: true });
    copyTree(templateDir, target);

    for (const rel of walk(target)) {
      if (/^scripts\/.*\.sh$/.test(rel) || /^\.claude\/skills\/.+\/scripts\/.+\.sh$/.test(rel)) {
        makeExecutable(join(target, rel));
      }
    }

    const files = buildFileHashes(target);
    writeManifest(target, newManifest({ starterVersion, starterRef, files }));

    if (gitAvailable()) {
      gitInit(target);
      gitAddAll(target);
      gitCommit(target, `chore: initialize project from ai-project-starter v${starterVersion} (CLI)`);
      info(`\nCreated ${target} (starter v${starterVersion}) and made the first commit.`);
    } else {
      warn('git not found — files were copied but no repo was initialized. Install git, then `git init && git add -A && git commit`.');
    }

    section('Doctor check:');
    runDoctor(target, { quiet: false });

    section('Next steps:');
    info(`  1. cd ${target}`);
    info('  2. Fill in AGENTS.md section 0 (name, purpose, stack, administrator, knobs).');
    info('  3. bash scripts/gate.sh   (or ask Claude to run it)');
    info('  4. git remote add origin <your-repo> && git push -u origin main');
  } finally {
    cleanup();
  }
}
