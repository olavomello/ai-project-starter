import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

  const adrDir = join(target, 'docs', 'adr');
  if (isDir(adrDir)) {
    const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
    for (const f of adrFiles) {
      const text = readText(join(adrDir, f));
      const problems = ['## Status', '## Context', '## Decision', '## Consequences']
        .filter((h) => !text.includes(h))
        .map((h) => `missing "${h}"`);
      if (problems.length) { failed = true; say(warn, `docs/adr/${f}: ${problems.join(', ')}`); }
      else say(ok, `docs/adr/${f}`);
    }
  }

  const settingsPath = join(target, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      JSON.parse(readText(settingsPath));
      say(ok, '.claude/settings.json is valid JSON');
    } catch (e) {
      failed = true; say(warn, `.claude/settings.json: invalid JSON (${e.message})`);
    }
  }

  // Session-mod state — informational only; never fails doctor on its own.
  const modScript = join(target, 'scripts', 'mod.mjs');
  if (existsSync(modScript)) {
    try {
      const out = execFileSync(process.execPath, [modScript, 'status', '--dir', target, '--json'], { encoding: 'utf8' });
      const { mod } = JSON.parse(out);
      if (mod.enabled === null) {
        say(info, 'starter-hud mod: not configured');
      } else {
        say(info, `starter-hud mod: ${mod.enabled ? 'enabled' : 'disabled'} (${mod.source} settings)`);
        if (mod.enabled && !mod.ref) {
          say(warn, 'starter-hud mod is enabled but its marketplace entry is missing — run `node scripts/mod.mjs enable` again.');
        }
      }
    } catch (e) {
      say(warn, `could not read session-mod state (${e.message})`);
    }
  }

  const hooksDir = join(target, '.claude', 'hooks');
  // Windows has no execute bit (stat always reports 0o666), so this check can't mean anything there.
  if (isDir(hooksDir) && process.platform !== 'win32') {
    const hookFiles = readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));
    for (const f of hookFiles) {
      const mode = statSync(join(hooksDir, f)).mode;
      if (mode & 0o111) say(ok, `.claude/hooks/${f} is executable`);
      else { failed = true; say(warn, `.claude/hooks/${f} is not executable (chmod +x)`); }
    }
  }

  if (existsSync(join(target, 'scripts', 'skills.mjs')) && isDir(join(target, '.claude', 'skills'))) {
    try {
      const out = execFileSync('node', ['scripts/skills.mjs', 'check', '--json'], { cwd: target, encoding: 'utf8' });
      const skills = JSON.parse(out).skills;
      say(ok, `${skills.length} skill${skills.length === 1 ? '' : 's'}, frontmatter valid`);
      for (const k of skills) for (const w of k.warnings) say(warn, `.claude/skills/${k.dir}/SKILL.md: ${w}`);
    } catch (e) {
      failed = true;
      let skills = [];
      try { skills = JSON.parse(e.stdout || '{}').skills || []; } catch { /* not JSON: script itself failed */ }
      const bad = skills.filter((k) => k.errors.length);
      if (!bad.length) say(warn, `could not check skills (${e.message.split('\n')[0]})`);
      for (const k of bad) for (const m of k.errors) say(warn, `.claude/skills/${k.dir}/SKILL.md: ${m}`);
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
