// The "does the whole chain work" checks behind `doctor`, and the repairs behind
// `doctor --fix`. Each failure that used to surface as a mystery (an empty Live
// panel, zero tokens, a worktree without hooks) is named here with its fix.
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mergeSettings } from './settings-merge.js';
import { MOD_ID, LEGACY_MOD_ID, MARKETPLACE, runClaude, modInstalled, legacyInstalled, uninstallLegacy, installMod, installCommands } from './claude-plugin.js';

/** Is the mod enabled in these settings, under its current or its old (starter-hud) name? */
const modEnabled = (settings) => settings?.enabledPlugins?.[MOD_ID] === true || settings?.enabledPlugins?.[LEGACY_MOD_ID] === true;

// Hooks the live panel and activity chart need, as [event, command fragment].
const LIVE_HOOKS = [
  ['SubagentStart', 'agent-live.mjs start'],
  ['SubagentStop', 'agent-live.mjs stop'],
  ['UserPromptSubmit', 'agent-live.mjs session-start'],
  ['Stop', 'agent-live.mjs session-stop'],
  ['PreToolUse', 'agent-live.mjs tool'],
];
// Tags up to v0.1.0 predate the ai-dash mod (no mods/ folder).
const MODLESS_TAG = /^v0\.(0\.\d+|1\.0)(-.*)?$/;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const runsHook = (settings, event, fragment) =>
  (settings.hooks?.[event] || []).some((g) => (g.hooks || []).some((h) => String(h.command || '').includes(fragment)));

/** Names of the other git worktrees of `target` whose .claude/settings.json does not enable the mod. */
function worktreesWithoutMod(target) {
  let out;
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return []; }
  const norm = (x) => String(x).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const here = norm(resolve(target));
  const behind = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const path = line.slice('worktree '.length).trim();
    if (norm(path) === here) continue;
    const settings = readJson(join(path, '.claude', 'settings.json'));
    if (!modEnabled(settings)) behind.push(path.replace(/\\/g, '/').split('/').pop());
  }
  return behind;
}

export const COMMIT_HINT = 'git add -A && git commit -m "chore: sync ai-project-starter"';

/**
 * Findings about the Claude Code setup of a project: `[{ level: 'ok'|'warn'|'info', msg, fix? }]`.
 * Needs no network; asks the `claude` CLI (via `run`) only when the mod is enabled.
 */
export function checkSetup(target, { run = runClaude } = {}) {
  const found = [];
  const settings = readJson(join(target, '.claude', 'settings.json'));
  if (!settings) return found; // doctor already reports a missing or invalid file

  if (existsSync(join(target, 'scripts', 'agent-live.mjs'))) {
    const missing = LIVE_HOOKS.filter(([event, fragment]) => !runsHook(settings, event, fragment)).map(([event]) => event);
    if (missing.length) {
      found.push({ level: 'warn', msg: `live-agent hooks missing from .claude/settings.json (${missing.join(', ')}): the dashboard's Live panel and Activity chart stay empty`, fix: 'ai-project-starter doctor --fix' });
    } else found.push({ level: 'ok', msg: 'live-agent hooks are in .claude/settings.json' });
  }

  if (!(settings.permissions?.deny || []).includes('Read(.env)')) {
    found.push({ level: 'warn', msg: 'no deny rule keeps Claude Code away from .env files (.claude/settings.json permissions.deny)', fix: 'ai-project-starter doctor --fix' });
  }

  if (modEnabled(settings)) {
    const legacyKey = settings.enabledPlugins?.[LEGACY_MOD_ID] !== undefined;
    if (legacyKey) {
      found.push({ level: 'warn', msg: 'the mod was renamed from starter-hud to ai-dash: this project still enables it under the old name, and the old plugin cannot be updated any more', fix: 'ai-project-starter doctor --fix' });
    }
    const entry = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source;
    let ref = 'main';
    if (!entry) {
      found.push({ level: 'warn', msg: 'ai-dash is enabled but its marketplace entry is missing from .claude/settings.json', fix: 'node scripts/mod.mjs enable' });
    } else if (typeof entry.ref === 'string' && MODLESS_TAG.test(entry.ref)) {
      found.push({ level: 'warn', msg: `ai-dash marketplace is pinned to ${entry.ref}, a tag that predates the mod: it can never install`, fix: 'ai-project-starter doctor --fix' });
    } else if (entry && entry.ref) ref = entry.ref;
    const installed = legacyKey ? null : modInstalled(target, run); // the old name is handled by the warning above
    if (legacyKey) { /* nothing more to say until it is renamed */ } else if (installed === true) found.push({ level: 'ok', msg: 'ai-dash plugin is installed' });
    else if (installed === false) {
      found.push({ level: 'warn', msg: 'ai-dash is enabled in settings but not installed on this machine, so no tokens or models are measured (settings alone do not download a plugin)', fix: `ai-project-starter doctor --fix   (or: ${installCommands(ref).join(' && ')})` });
    } else found.push({ level: 'info', msg: 'could not ask the claude CLI whether ai-dash is installed (is `claude` on PATH?)' });
    const behind = worktreesWithoutMod(target);
    if (behind.length) {
      found.push({ level: 'warn', msg: `ai-dash is not enabled in ${behind.length} git worktree${behind.length === 1 ? '' : 's'} (${behind.slice(0, 3).join(', ')}${behind.length > 3 ? ', ...' : ''}): a session there runs without the mod, so its tokens and model are never measured`, fix: 'commit .claude/settings.json, then merge this branch into each worktree branch (git merge main)' });
    }
    if (installed === true && existsSync(join(target, '.agents', 'log', 'executions.jsonl')) && !existsSync(join(target, '.agents', 'state', 'usage'))) {
      found.push({ level: 'info', msg: 'ai-dash is installed but has not measured a session yet: start a new Claude Code session in this folder' });
    }
  }

  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', '.claude', ':(exclude).claude/worktrees', ':(exclude).claude/settings.local.json', 'scripts', 'docs/agents', 'ai-dash'],
      { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) {
      const n = out.split('\n').length;
      found.push({ level: 'warn', msg: `${n} uncommitted setup file${n === 1 ? '' : 's'} (.claude, scripts, docs/agents, ai-dash): a Claude session in a git worktree, such as the desktop app's, only sees committed files`, fix: COMMIT_HINT });
    }
  } catch { /* not a git repository */ }

  return found;
}

/**
 * Repairs what can be repaired safely: merges the starter's hooks, deny rules and the marketplace pin
 * into settings.json, regenerates the Claude Code agent pointers, and installs the mod if it is enabled
 * but missing. Never commits. Returns `[{ ok, msg }]`.
 */
export function fixSetup(target, { templateSettingsText, ref = 'main', run = runClaude } = {}) {
  const results = [];
  const settingsPath = join(target, '.claude', 'settings.json');
  if (templateSettingsText && existsSync(settingsPath)) {
    const { text, added } = mergeSettings(readFileSync(settingsPath, 'utf8'), templateSettingsText);
    if (text === null) results.push({ ok: false, msg: '.claude/settings.json is not valid JSON; fix it by hand first' });
    else if (added.length) { writeFileSync(settingsPath, text); results.push({ ok: true, msg: `.claude/settings.json: added ${added.length} starter entr${added.length === 1 ? 'y' : 'ies'} (hooks, deny rules, marketplace pin)` }); }
  }
  const sync = join(target, 'scripts', 'agents-sync.mjs');
  if (existsSync(sync)) {
    try {
      execFileSync(process.execPath, [sync, '--dir', target], { stdio: 'ignore' });
      results.push({ ok: true, msg: 'Claude Code agent pointers (.claude/agents/) are in sync with docs/agents/' });
    } catch { results.push({ ok: false, msg: 'node scripts/agents-sync.mjs failed' }); }
  }
  const settings = readJson(settingsPath);
  if (settings?.enabledPlugins?.[MOD_ID] === true && modInstalled(target, run) === false) {
    const entryRef = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref || ref;
    const r = installMod({ cwd: target, ref: entryRef, run });
    for (const s of r.steps) results.push({ ok: s.ok, msg: `${s.cmd}${s.ok ? '' : `  (${s.detail || 'failed'})`}` });
    if (!r.ok) results.push({ ok: false, msg: `install it by hand: ${r.manual.join(' && ')}` });
  }
  // The old starter-hud plugin goes once the new one is in place (settings were renamed by the merge above).
  if (modEnabled(settings) && legacyInstalled(target, run) === true) {
    const u = uninstallLegacy({ cwd: target, run });
    results.push({ ok: u.ok, msg: `${u.cmd}${u.ok ? '' : `  (${u.detail || 'failed'})`}` });
  }
  return results;
}
