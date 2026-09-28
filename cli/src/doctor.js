import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { readText, isDir } from './lib/fsutil.js';
import { readManifest } from './lib/manifest.js';
import { info, ok, warn, section } from './lib/log.js';

const REQUIRED_FILES = [
  'AGENTS.md', 'CLAUDE.md', 'VERSION', 'CHANGELOG.md',
  'scripts/gate.sh', 'docs/tasks.md',
];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function doctor({ target = '.' }) {
  const failed = runDoctor(target, { quiet: false });
  process.exit(failed ? 1 : 0);
}

/** Returns true if any check failed. Used by both `doctor` and `init`'s summary. */
export function runDoctor(target, { quiet }) {
  let failed = false;
  const say = (fn, msg) => { if (!quiet) fn(msg); };

  for (const rel of REQUIRED_FILES) {
    if (existsSync(join(target, rel))) say(ok, rel);
    else { failed = true; say(warn, `missing ${rel}`); }
  }

  const versionPath = join(target, 'VERSION');
  if (existsSync(versionPath)) {
    const v = readText(versionPath).trim();
    if (SEMVER.test(v)) say(ok, `VERSION ${v} is valid SemVer`);
    else { failed = true; say(warn, `VERSION "${v}" is not valid SemVer`); }
  }

  const changelogPath = join(target, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    if (readText(changelogPath).includes('## [Unreleased]')) say(ok, 'CHANGELOG has [Unreleased]');
    else { failed = true; say(warn, 'CHANGELOG missing "## [Unreleased]"'); }
  }

  const agentsDir = join(target, 'docs', 'agents');
  if (isDir(agentsDir)) {
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md');
    for (const f of agentFiles) {
      const text = readText(join(agentsDir, f));
      const problems = [];
      if (!/^##\s*CONFIGS/m.test(text)) problems.push('missing "## CONFIGS"');
      if (!/^##\s*SCOPE AND RULES/mi.test(text)) problems.push('missing "## SCOPE AND RULES"');
      if (!/Status\s*:\s*(ON|OFF)/.test(text)) problems.push('missing "Status: ON|OFF"');
      if (problems.length) { failed = true; say(warn, `docs/agents/${f}: ${problems.join(', ')}`); }
      else say(ok, `docs/agents/${f}`);
    }
  }

  const manifest = readManifest(target);
  if (manifest) {
    say(info, `\nCreated from ai-project-starter v${manifest.starterVersion} (${manifest.starterRef.slice(0, 12)}).`);
    say(info, `Run \`ai-project-starter update\` to check for starter improvements.`);
  } else {
    say(info, '\nNo .ai-project-starter.json — this project isn\'t tracked by the CLI yet.');
    say(info, 'Run `ai-project-starter adopt` to enable `update` for it.');
  }

  return failed;
}
