// Resolves "where do we get the starter's template/ from" for init/update/adopt.
// --source accepts a git URL (the default) or a local path that already
// contains a template/ folder (a clone you already have, or this repo
// itself during development) — handy for testing without hitting the network.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readText, isDir, existsSync } from './fsutil.js';
import { gitAvailable, gitCloneShallow, gitRevParseHead } from './exec.js';
import { STARTER_REPO } from './manifest.js';

export function resolveSource({ source = STARTER_REPO, ref = 'main' }) {
  if (isDir(source) && isDir(join(source, 'template'))) {
    const templateDir = join(source, 'template');
    const starterVersion = existsSync(join(source, 'VERSION'))
      ? readText(join(source, 'VERSION')).trim()
      : 'local';
    const starterRef = gitAvailable() ? gitRevParseHead(source) : 'local';
    return { templateDir, starterVersion, starterRef, cleanup() {} };
  }

  if (!gitAvailable()) {
    throw new Error(
      'git is required to fetch the starter template (not bash — plain `git`, which works ' +
      'natively on Windows). Install it from https://git-scm.com, or pass --source <local-clone-path>.',
    );
  }
  const tmp = mktempClone(source, ref);
  const templateDir = join(tmp, 'template');
  if (!isDir(templateDir)) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`${source}#${ref} has no template/ directory — is this the starter repo?`);
  }
  const starterVersion = existsSync(join(tmp, 'VERSION')) ? readText(join(tmp, 'VERSION')).trim() : 'unknown';
  const starterRef = gitRevParseHead(tmp);
  return { templateDir, starterVersion, starterRef, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function mktempClone(url, ref) {
  const tmp = mkdtempSync(join(tmpdir(), 'ai-project-starter-'));
  const dest = join(tmp, 'src');
  gitCloneShallow(url, ref, dest);
  return dest;
}
