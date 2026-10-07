#!/usr/bin/env node
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { init } from './src/init.js';
import { update } from './src/update.js';
import { doctor } from './src/doctor.js';
import { adopt } from './src/adopt.js';
import { die } from './src/lib/log.js';

const [, , cmd, ...rest] = process.argv;

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { flags.dryRun = true; continue; }
    if (a === '--force') { flags.force = true; continue; }
    if (a === '--fix') { flags.fix = true; continue; }
    if (a === '--no-prompt') { flags.noPrompt = true; continue; }
    if (a === '--mod') { flags.mod = true; continue; }
    if (a === '--no-mod') { flags.mod = false; continue; }
    if (a === '--local') { flags.local = true; continue; }
    if (a === '--json') { flags.json = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) die(`${a} needs a value`);
      flags[key] = val; i++; continue;
    }
    positional.push(a);
  }
  return { positional, flags };
}

const HELP = `ai-project-starter — bootstrap and maintain projects built on the starter.

Usage:
  ai-project-starter init <target-dir> [--ref <branch-or-tag>] [--source <path-or-url>] [--no-prompt] [--mod|--no-mod]
      Create a new project from the starter template. Interactively asks for
      AGENTS.md section 0 (name, purpose, stack, administrator, knobs,
      including the optional session mod) when run in a terminal, so the
      first commit is already filled in; skip with --no-prompt (also
      skipped automatically outside a TTY, e.g. in CI). --mod/--no-mod
      answers the session-mod question outright, interactive or not.

  ai-project-starter update [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--dry-run]
      Pull starter improvements into an existing project. Only ever changes a
      file the project hasn't customized; anything else is flagged, never
      silently overwritten. Requires the project to have .ai-project-starter.json
      (run \`adopt\` first for a project created before this CLI existed).

  ai-project-starter adopt [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--force]
      Register an existing project so \`update\` can track it, using the
      project's current files as the baseline.

  ai-project-starter doctor [<target-dir>] [--fix] [--ref <ref>] [--source <path>]
      Structural health check: required files, valid VERSION, changelog
      shape, each docs/agents/*.md well-formed, plus the Claude Code setup
      the dashboard depends on (hooks, deny rules, the mod's marketplace pin
      and install, uncommitted setup files). Exit code 1 on failure.
      --fix repairs what is safe: adds the starter's hooks, deny rules and mod
      pin to .claude/settings.json, regenerates .claude/agents/, and installs
      the mod's plugin when it is enabled but missing. It never commits.

  ai-project-starter mod <status|enable|disable> [<target-dir>] [--local] [--ref <ref>] [--json]
      Turn the optional starter-hud session mod on or off, or report its
      state. Delegates to <target-dir>/scripts/mod.mjs — run \`update\` first
      if that script doesn't exist yet in an older project.

--ref defaults to "main". --source defaults to the starter's GitHub repo;
pass a local path (one containing a template/ folder) to skip the network.
`;

switch (cmd) {
  case 'init': {
    const { positional, flags } = parseFlags(rest);
    await init({
      target: positional[0], ref: flags.ref, source: flags.source,
      noPrompt: !!flags.noPrompt, mod: flags.mod,
    });
    break;
  }
  case 'update': {
    const { positional, flags } = parseFlags(rest);
    update({ target: positional[0] || '.', ref: flags.ref, source: flags.source, dryRun: !!flags.dryRun });
    break;
  }
  case 'adopt': {
    const { positional, flags } = parseFlags(rest);
    adopt({ target: positional[0] || '.', ref: flags.ref, source: flags.source, force: !!flags.force });
    break;
  }
  case 'doctor': {
    const { positional, flags } = parseFlags(rest);
    doctor({ target: positional[0] || '.', fix: !!flags.fix, source: flags.source, ref: flags.ref });
    break;
  }
  case 'mod': {
    const { positional, flags } = parseFlags(rest);
    const sub = positional[0];
    const target = positional[1] || '.';
    if (!['status', 'enable', 'disable'].includes(sub)) {
      die('usage: ai-project-starter mod <status|enable|disable> [<target-dir>] [--local] [--ref <ref>] [--json]');
    }
    const modScript = join(target, 'scripts', 'mod.mjs');
    if (!existsSync(modScript)) {
      die(`${modScript} not found — run \`ai-project-starter update\` first (it's only in newer projects).`);
    }
    const args = [modScript, sub, '--dir', target];
    if (flags.local) args.push('--local');
    if (flags.json) args.push('--json');
    if (flags.ref) args.push('--ref', flags.ref);
    try {
      execFileSync(process.execPath, args, { stdio: 'inherit' });
    } catch (e) {
      process.exit(e.status ?? 1);
    }
    break;
  }
  case '--help':
  case '-h':
  case 'help':
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command "${cmd}".\n`);
    console.log(HELP);
    process.exit(1);
}
