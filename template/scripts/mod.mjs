#!/usr/bin/env node
// Single source of truth for turning the optional starter-hud session mod
// on or off. Both `cli/bin.js`'s `mod` command and `scripts/ai-dash.mjs`'s
// local server call these exported functions — there is no second copy of
// this logic anywhere (see docs/adr for the session-mod ADR).
//
// Usage:
//   node scripts/mod.mjs status  [--dir <path>] [--json]
//   node scripts/mod.mjs enable  [--dir <path>] [--local] [--ref <branch-or-tag>]
//   node scripts/mod.mjs disable [--dir <path>] [--local]
//
// The default target is .claude/settings.json (shared, committed). --local
// targets .claude/settings.local.json (personal, git-ignored) instead.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ID = 'starter-hud@ai-project-starter';
const MARKETPLACE_NAME = 'ai-project-starter';
const MARKETPLACE_REPO = 'olavomello/ai-project-starter';

function settingsPath(dir, local) {
  return join(dir, '.claude', local ? 'settings.local.json' : 'settings.json');
}

// The mod first shipped after v0.1.0: that tag has no mods/ folder, so a marketplace pinned
// to it can't install the plugin and nothing measures usage. Projects created from 0.1.0 or
// older therefore track main; newer starter versions pin to their own tag.
const LAST_VERSION_WITHOUT_MOD = [0, 1, 0];

function newerThanModless(version) {
  const parts = String(version).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10));
  if (parts.length < 3 || parts.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== LAST_VERSION_WITHOUT_MOD[i]) return parts[i] > LAST_VERSION_WITHOUT_MOD[i];
  }
  return false;
}

function starterVersionTag(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, '.ai-project-starter.json'), 'utf8'));
    if (manifest.starterVersion && newerThanModless(manifest.starterVersion)) return `v${manifest.starterVersion}`;
  } catch { /* no manifest, or unreadable — fall back to main */ }
  return 'main';
}

/** Reads a settings file as JSON, or {} if it doesn't exist yet. Throws on invalid JSON. */
function readSettings(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON (${e.message})`);
  }
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Sets enabledPlugins[PLUGIN_ID] and, on enable, makes sure the marketplace
 * entry exists. Preserves every other key. Idempotent: calling `enable`
 * (or `disable`) twice in a row produces byte-identical output the second
 * time.
 */
export function setModEnabled(dir, enabled, { local = false, ref } = {}) {
  const path = settingsPath(dir, local);
  const settings = readSettings(path);

  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[PLUGIN_ID] = enabled;

  if (enabled) {
    settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
    if (!settings.extraKnownMarketplaces[MARKETPLACE_NAME]) {
      settings.extraKnownMarketplaces[MARKETPLACE_NAME] = {
        source: { source: 'github', repo: MARKETPLACE_REPO, ref: ref || starterVersionTag(dir) },
      };
    } else if (ref) {
      settings.extraKnownMarketplaces[MARKETPLACE_NAME].source.ref = ref;
    }
  }

  writeSettings(path, settings);
  return statusOf(dir);
}

export function enableMod(dir, opts) { return setModEnabled(dir, true, opts); }
export function disableMod(dir, opts) { return setModEnabled(dir, false, opts); }

/** Reports enabled/disabled/not-configured, which file decided it, and the pinned ref. */
export function statusOf(dir) {
  const projectPath = settingsPath(dir, false);
  const localPath = settingsPath(dir, true);

  // Local overrides project (same precedence Claude Code itself documents:
  // local > project > user — see docs/guides/claude-code.md).
  for (const [path, source] of [[localPath, 'local'], [projectPath, 'project']]) {
    if (!existsSync(path)) continue;
    let settings;
    try { settings = readSettings(path); } catch { continue; }
    const value = settings.enabledPlugins?.[PLUGIN_ID];
    if (value === undefined) continue;
    const ref = settings.extraKnownMarketplaces?.[MARKETPLACE_NAME]?.source?.ref ?? null;
    return { enabled: value === true, source, ref, path };
  }
  return { enabled: null, source: null, ref: null, path: projectPath };
}

// ---- CLI entrypoint (skipped when imported, e.g. by ai-dash.mjs) ----
function die(msg) { console.error(`mod: ${msg}`); process.exit(1); }

function parseFlags(argv) {
  const flags = { dir: '.' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') { flags.local = true; continue; }
    if (a === '--json') { flags.json = true; continue; }
    if (a === '--dir') { flags.dir = argv[++i]; continue; }
    if (a === '--ref') { flags.ref = argv[++i]; continue; }
    die(`unknown argument: ${a}`);
  }
  return flags;
}

function printStatus(dir, status, json) {
  if (json) {
    console.log(JSON.stringify({ mod: status }, null, 2));
    return;
  }
  if (status.enabled === null) {
    console.log(`starter-hud: not configured (would write ${status.path})`);
  } else {
    console.log(`starter-hud: ${status.enabled ? 'enabled' : 'disabled'} (${status.source} settings, ${status.path})`);
    if (status.ref) console.log(`  marketplace ref: ${status.ref}`);
  }
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);

  switch (cmd) {
    case 'status': {
      printStatus(flags.dir, statusOf(flags.dir), flags.json);
      break;
    }
    case 'enable': {
      try {
        const status = enableMod(flags.dir, { local: flags.local, ref: flags.ref });
        printStatus(flags.dir, status, flags.json);
        console.log('Run /reload-plugins (or restart the session), then commit the settings file.');
      } catch (e) { die(e.message); }
      break;
    }
    case 'disable': {
      try {
        const status = disableMod(flags.dir, { local: flags.local });
        printStatus(flags.dir, status, flags.json);
        console.log('Run /reload-plugins (or restart the session), then commit the settings file.');
      } catch (e) { die(e.message); }
      break;
    }
    default: {
      console.log('Usage: node scripts/mod.mjs status|enable|disable [--dir <path>] [--local] [--ref <ref>] [--json]');
      process.exit(cmd ? 1 : 0);
    }
  }
}

// Only run as a CLI when invoked directly (not when imported by ai-dash.mjs
// or the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
