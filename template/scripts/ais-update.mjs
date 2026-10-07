#!/usr/bin/env node
// Checks whether a newer ai-project-starter exists than the one this project was last synced with,
// and applies the update. Used by the starter-hud mod's "Update available" button, and fine to run
// by hand.
//
//   node scripts/ais-update.mjs check [--force] [--json]   is there a newer starter? (cached 30 min)
//   node scripts/ais-update.mjs apply                      run `ai-project-starter update`, then re-check
//
// "Newer" means the starter's `main` points at a different commit than the `starterRef` recorded in
// `.ai-project-starter.json` by `init` / `update` / `adopt`. The check asks git (`ls-remote`, no
// clone), so it needs git and network but nothing else, and it never changes the project.
//
// Environment, for tests and forks: AIS_REPO (git URL or path, default the starter's GitHub repo),
// AIS_REF (default main), AIS_UPDATE_CMD (JSON array replacing the update command).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_REPO = 'https://github.com/olavomello/ai-project-starter.git';
export const CACHE_MS = 30 * 60 * 1000;
const CACHE_FILE = join('.agents', 'state', 'update-check.json');
const MANIFEST = '.ai-project-starter.json';

const short = (sha) => (sha ? String(sha).slice(0, 7) : null);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** The commit `ref` points at on `repo`, via `git ls-remote` (no clone). Throws when it can't be read. */
export function remoteHead(repo = DEFAULT_REPO, ref = 'main') {
  const out = execFileSync('git', ['ls-remote', repo, `refs/heads/${ref}`], {
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const sha = out.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no ${ref} branch found on ${repo}`);
  return sha;
}

/**
 * `{ available, current, latest, checkedAt, error? }` for the project at `dir`.
 * `available` is true only when both commits are known and differ. A cached answer younger than
 * CACHE_MS is reused unless `force`. Never throws: a failed lookup is reported in `error`.
 */
export function checkUpdate(dir = '.', { force = false, now = Date.now(), repo = process.env.AIS_REPO || DEFAULT_REPO, ref = process.env.AIS_REF || 'main', lookup = remoteHead } = {}) {
  const manifest = readJson(join(dir, MANIFEST));
  const current = manifest && typeof manifest.starterRef === 'string' ? manifest.starterRef : null;
  const cachePath = join(dir, CACHE_FILE);
  const cache = readJson(cachePath);

  let latest = null, error = null, checkedAt = now;
  if (!force && cache && typeof cache.latest === 'string' && now - cache.checkedAt < CACHE_MS) {
    latest = cache.latest; checkedAt = cache.checkedAt;
  } else {
    try {
      latest = lookup(repo, ref);
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify({ checkedAt: now, latest }));
    } catch (e) {
      error = String(e.message || e).split('\n')[0].slice(0, 200);
      if (cache && typeof cache.latest === 'string') { latest = cache.latest; checkedAt = cache.checkedAt; } // stale beats nothing
    }
  }
  if (!current) error = error || `no ${MANIFEST}: run \`ai-project-starter adopt\` so updates can be tracked`;
  const available = Boolean(current && latest && !latest.startsWith(current) && !current.startsWith(latest));
  const out = { available, current: short(current), latest: short(latest), checkedAt };
  if (error) out.error = error;
  return out;
}

/** The command that updates a project: `npx` runs the starter's CLI straight from GitHub. */
export function updateCommand(env = process.env, platform = process.platform) {
  if (env.AIS_UPDATE_CMD) {
    const argv = JSON.parse(env.AIS_UPDATE_CMD);
    if (!Array.isArray(argv) || !argv.length) throw new Error('AIS_UPDATE_CMD must be a JSON array');
    return argv.map(String);
  }
  const ref = env.AIS_REF || 'main';
  return [platform === 'win32' ? 'npx.cmd' : 'npx', '--yes', `github:olavomello/ai-project-starter#${ref}`, 'update'];
}

function run(argv, cwd) {
  const quote = (a) => (/^[\w./#@:=-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '')}"`);
  // .cmd shims (npx, claude) can only be started through a shell on Windows
  return process.platform === 'win32' && /\.cmd$|^claude$/.test(argv[0])
    ? spawnSync(argv.map(quote).join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit' });
}

/**
 * Updates the project at `dir`, then asks Claude Code to update the starter-hud plugin (best effort:
 * a running session keeps the old code until it is restarted), then re-checks. Returns `{ ok, check }`.
 */
export function applyUpdate(dir = '.', { env = process.env } = {}) {
  const r = run(updateCommand(env), dir);
  const ok = r.status === 0;
  if (ok && !env.AIS_UPDATE_CMD) {
    const plugin = run(['claude', 'plugin', 'update', 'starter-hud@ai-project-starter'], dir);
    if (plugin.status !== 0) console.log('(could not update the starter-hud plugin; run: claude plugin update starter-hud@ai-project-starter)');
  }
  return { ok, check: checkUpdate(dir, { force: true }) };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest);
  if (cmd === 'check') {
    const r = checkUpdate('.', { force: flags.has('--force') });
    if (flags.has('--json')) console.log(JSON.stringify(r));
    else if (r.error && !r.latest) console.log(`could not check for updates: ${r.error}`);
    else if (r.available) console.log(`update available: ${r.current} -> ${r.latest}. Run: node scripts/ais-update.mjs apply`);
    else console.log(`up to date (${r.current})`);
    return;
  }
  if (cmd === 'apply') {
    const { ok, check } = applyUpdate('.');
    console.log(ok ? (check.available ? 'updated, but a newer starter exists already' : 'updated; commit the changes so worktrees get them: git add -A && git commit -m "chore: sync ai-project-starter"') : 'update failed');
    process.exit(ok ? 0 : 1);
  }
  console.log('Usage: node scripts/ais-update.mjs check [--force] [--json] | apply');
  process.exit(cmd ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
