import { join } from 'node:path';
import { existsSync, readJSON, writeJSON, walk, hashFile } from './fsutil.js';

export const MANIFEST_FILE = '.ai-project-starter.json';
export const STARTER_REPO = 'https://github.com/olavomello/ai-project-starter.git';

// Files a project always customizes for itself. `update` never overwrites
// these — it only reports that the starter's own copy changed, so a human
// decides whether/how to fold that in. A path ending in "/" matches the
// whole subtree.
export const PROTECTED = [
  'AGENTS.md',
  'AGENT_TEAM.md',
  'VERSION',
  'CHANGELOG.md',
  'docs/model-prices.json',
  'docs/agents/',
];

export function isProtected(relPath) {
  return PROTECTED.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

export function buildFileHashes(templateDir) {
  const map = {};
  for (const f of walk(templateDir)) map[f] = hashFile(join(templateDir, f));
  return map;
}

export function readManifest(projectDir) {
  const p = join(projectDir, MANIFEST_FILE);
  return existsSync(p) ? readJSON(p) : null;
}

export function writeManifest(projectDir, manifest) {
  writeJSON(join(projectDir, MANIFEST_FILE), manifest);
}

export function newManifest({ starterVersion, starterRef, files }) {
  const now = new Date().toISOString();
  return {
    $schema: 'ai-project-starter/manifest@1',
    starter: STARTER_REPO,
    starterVersion,
    starterRef,
    createdAt: now,
    updatedAt: now,
    files,
  };
}
