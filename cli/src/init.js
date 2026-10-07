import { join, basename, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, copyTree, makeExecutable, isDir, walk,
} from './lib/fsutil.js';
import { gitAvailable, gitInit, gitAddAll, gitCommit } from './lib/exec.js';
import { resolveSource } from './lib/source.js';
import { buildFileHashes, newManifest, writeManifest } from './lib/manifest.js';
import { die, info, ok, section, warn } from './lib/log.js';
import { installMod, claudeAvailable, installCommands } from './lib/claude-plugin.js';
import { readText } from './lib/fsutil.js';
import { runDoctor } from './doctor.js';
import { guideAgentsSetup } from './setup.js';

export async function init({ target, ref = 'main', source, noPrompt = false, mod }) {
  if (!target) die('usage: ai-project-starter init <target-dir> [--ref <branch-or-tag>] [--source <path-or-url>] [--no-prompt]');
  if (existsSync(target) && readdirSync(target).length > 0) {
    die(`target "${target}" exists and is not empty`);
  }

  section(`Fetching starter (${source || 'https://github.com/olavomello/ai-project-starter.git'}#${ref})...`);
  const { templateDir, starterVersion, starterRef, cleanup } = resolveSource({ source, ref });

  try {
    mkdirSync(target, { recursive: true });
    copyTree(templateDir, target);

    for (const rel of walk(target)) {
      if (/^scripts\/.*\.sh$/.test(rel) || /^\.claude\/skills\/.+\/scripts\/.+\.sh$/.test(rel) || /^\.claude\/hooks\/.+\.sh$/.test(rel)) {
        makeExecutable(join(target, rel));
      }
    }

    const projectNameHint = basename(resolve(target));
    const { configured, mod: enableModFlag } = await guideAgentsSetup(target, {
      skip: noPrompt, projectNameHint, modFlag: mod,
    });

    // Run before the manifest hashes are computed (below), so the first
    // commit and the manifest baseline both already include the toggle —
    // same reasoning as hashing after the guided setup.
    if (enableModFlag) {
      const modScript = join(target, 'scripts', 'mod.mjs');
      if (existsSync(modScript)) {
        try {
          execFileSync(process.execPath, [modScript, 'enable', '--dir', target], { stdio: ['ignore', 'ignore', 'inherit'] }); // its install hints are printed once, below
        } catch {
          warn('Could not enable the session mod automatically — run `node scripts/mod.mjs enable` yourself.');
        }
      }
      installModPlugin(target);
    }

    // Hashed after the guided setup (if any) so the manifest baseline reflects
    // what's actually in the first commit, not the template's blank AGENTS.md.
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
    info('  2. Open Claude Code here and run the starter agent (it sets up the rest, then is removed):');
    info('       "Run the starter agent: read docs/agents/sys-init-starter.md and follow it end to end."');
    info(configured
      ? '     Section 0 of AGENTS.md and README.md were already filled in during setup; it will skip them.'
      : '     Or do it by hand: fill in AGENTS.md section 0 and the README.md placeholders.');
    info('  3. bash scripts/gate.sh   (Windows: use Git Bash; or ask Claude to run it)');
    info('  4. git remote add origin <your-repo> && git push -u origin main');
  } finally {
    cleanup();
  }
}

/**
 * Enabling the mod only writes settings; Claude Code downloads a plugin only when it is installed.
 * Do that here so a new project measures tokens and models from its first session, or say exactly
 * what to run when the `claude` CLI isn't available.
 */
function installModPlugin(target) {
  section('Installing the starter-hud mod for Claude Code:');
  ok('enabled in .claude/settings.json');
  let ref = 'main';
  try { ref = JSON.parse(readText(join(target, '.claude', 'settings.json'))).extraKnownMarketplaces?.['ai-project-starter']?.source?.ref || 'main'; } catch { /* settings unreadable: default ref */ }
  if (!claudeAvailable()) {
    warn('The `claude` CLI was not found on PATH, so the plugin was not installed. Install it once with:');
    installCommands(ref).forEach((c) => info(`  ${c}`));
    return;
  }
  const result = installMod({ cwd: target, ref });
  for (const step of result.steps) (step.ok ? ok : warn)(step.cmd + (step.ok ? '' : `  (${step.detail || 'failed'})`));
  if (!result.ok) {
    warn('Install it by hand, then start a new Claude Code session:');
    result.manual.forEach((c) => info(`  ${c}`));
  }
}
