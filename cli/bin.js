#!/usr/bin/env node
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
  ai-project-starter init <target-dir> [--ref <branch-or-tag>] [--source <path-or-url>]
      Create a new project from the starter template.

  ai-project-starter update [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--dry-run]
      Pull starter improvements into an existing project. Only ever changes a
      file the project hasn't customized; anything else is flagged, never
      silently overwritten. Requires the project to have .ai-project-starter.json
      (run \`adopt\` first for a project created before this CLI existed).

  ai-project-starter adopt [<target-dir>] [--ref <branch-or-tag>] [--source <path>] [--force]
      Register an existing project so \`update\` can track it, using the
      project's current files as the baseline.

  ai-project-starter doctor [<target-dir>]
      Structural health check: required files, valid VERSION, changelog
      shape, each docs/agents/*.md well-formed. Exit code 1 on failure.

--ref defaults to "main". --source defaults to the starter's GitHub repo;
pass a local path (one containing a template/ folder) to skip the network.
`;

switch (cmd) {
  case 'init': {
    const { positional, flags } = parseFlags(rest);
    init({ target: positional[0], ref: flags.ref, source: flags.source });
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
    const { positional } = parseFlags(rest);
    doctor({ target: positional[0] || '.' });
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
