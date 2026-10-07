// Merges the starter's hooks into a project's customized `.claude/settings.json`.
//
// The session-mod toggle (and users) edit that file, so a plain three-way
// update would flag it as a conflict every time the starter adds a hook. Only
// the `hooks` section is merged: a starter hook is added unless the project
// already runs the same command for that event. Everything else in the
// project's file (enabledPlugins, extraKnownMarketplaces, its own hooks and
// permission rules, ...) is kept exactly as it is. The one other thing added is
// `permissions.deny`: starter deny rules the project doesn't have yet are appended
// in order, so a negation such as `Read(!.env.example)` stays after its parent rule.

import { MOD_ID, LEGACY_MOD_ID } from './claude-plugin.js';

const groupMatcher = (group) => (typeof group.matcher === 'string' ? group.matcher : '');
const commandOf = (hook) => (hook && hook.type === 'command' ? `${hook.command || ''}\u0000${(hook.args || []).join('\u0000')}` : JSON.stringify(hook));

// Tags up to v0.1.0 predate the ai-dash mod (their tree has no mods/ folder).
const MODLESS_TAG = /^v0\.(0\.\d+|1\.0)(-.*)?$/;

/**
 * The ai-dash marketplace pinned to a tag that predates the mod (which `mod enable`
 * used to write) can never install it. Moves that pin to main on the parsed settings
 * object and returns a description of the change, or null when nothing needed fixing.
 */
function fixModPinIn(settings) {
  const entry = settings && settings.extraKnownMarketplaces && settings.extraKnownMarketplaces['ai-project-starter'];
  const pin = entry && entry.source;
  if (!pin || typeof pin.ref !== 'string' || !String(pin.repo || '').endsWith('ai-project-starter')) return null;
  if (!MODLESS_TAG.test(pin.ref)) return null;
  const before = pin.ref;
  pin.ref = 'main';
  return `marketplace ref: ${before} -> main (that tag has no ai-dash mod)`;
}

/**
 * The mod was called starter-hud before it became ai-dash. A project that enabled it under the old name
 * moves to the new one, keeping the on/off value, so nothing has to be toggled again. Returns a description
 * of the change, or null when the old key is not there.
 */
function renameLegacyModIn(settings) {
  const plugins = settings && settings.enabledPlugins;
  if (!plugins || typeof plugins !== 'object' || !(LEGACY_MOD_ID in plugins)) return null;
  const value = plugins[LEGACY_MOD_ID];
  if (!(MOD_ID in plugins)) plugins[MOD_ID] = value;
  delete plugins[LEGACY_MOD_ID];
  return `enabledPlugins: ${LEGACY_MOD_ID} -> ${MOD_ID}`;
}

/** Every repair the mod's settings can need (an old marketplace pin, the old plugin name), as descriptions. */
function repairModIn(settings) {
  return [fixModPinIn(settings), renameLegacyModIn(settings)].filter(Boolean);
}

/** The same fix on settings text, for a file the starter has not otherwise changed. `text` is null when nothing changed. */
export function fixModPin(settingsText) {
  let settings;
  try { settings = JSON.parse(settingsText); } catch { return { text: null, change: null }; }
  const changes = repairModIn(settings);
  return changes.length ? { text: `${JSON.stringify(settings, null, 2)}\n`, change: changes.join('; ') } : { text: null, change: null };
}

/**
 * Returns `{ text, added }`: the merged file text (2-space JSON, trailing
 * newline) and the list of entries that were added or changed ("Event: command",
 * "deny: rule", the marketplace pin fix). `text` is null when either side isn't
 * valid JSON, so the caller can fall back to the plain conflict handling.
 */
export function mergeSettings(localText, incomingText) {
  let local, incoming;
  try { local = JSON.parse(localText); incoming = JSON.parse(incomingText); } catch { return { text: null, added: [] }; }
  if (!local || typeof local !== 'object' || Array.isArray(local)) return { text: null, added: [] };
  const wanted = incoming && incoming.hooks && typeof incoming.hooks === 'object' ? incoming.hooks : {};

  const added = [];
  added.push(...repairModIn(local));

  local.hooks = local.hooks && typeof local.hooks === 'object' ? local.hooks : {};
  for (const [event, groups] of Object.entries(wanted)) {
    if (!Array.isArray(groups)) continue;
    if (!Array.isArray(local.hooks[event])) local.hooks[event] = [];
    const have = new Set(local.hooks[event].flatMap((g) => (g.hooks || []).map(commandOf)));
    for (const group of groups) {
      const missing = (group.hooks || []).filter((h) => !have.has(commandOf(h)));
      if (!missing.length) continue;
      const target = local.hooks[event].find((g) => groupMatcher(g) === groupMatcher(group));
      if (target) target.hooks = [...(target.hooks || []), ...missing];
      else local.hooks[event].push({ ...group, hooks: missing });
      for (const h of missing) { have.add(commandOf(h)); added.push(`${event}: ${h.command}`); }
    }
  }
  if (!Object.keys(local.hooks).length) delete local.hooks;

  const wantedDeny = incoming && incoming.permissions && Array.isArray(incoming.permissions.deny) ? incoming.permissions.deny : [];
  if (wantedDeny.length) {
    local.permissions = local.permissions && typeof local.permissions === 'object' ? local.permissions : {};
    const deny = Array.isArray(local.permissions.deny) ? local.permissions.deny : [];
    for (const rule of wantedDeny) {
      if (typeof rule === 'string' && !deny.includes(rule)) { deny.push(rule); added.push(`deny: ${rule}`); }
    }
    local.permissions.deny = deny;
  }
  return { text: `${JSON.stringify(local, null, 2)}\n`, added };
}
