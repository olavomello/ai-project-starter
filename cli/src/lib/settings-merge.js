// Merges the starter's hooks into a project's customized `.claude/settings.json`.
//
// The session-mod toggle (and users) edit that file, so a plain three-way
// update would flag it as a conflict every time the starter adds a hook. Only
// the `hooks` section is merged: a starter hook is added unless the project
// already runs the same command for that event. Everything else in the
// project's file (enabledPlugins, extraKnownMarketplaces, its own hooks,
// permissions, ...) is kept exactly as it is.

const groupMatcher = (group) => (typeof group.matcher === 'string' ? group.matcher : '');
const commandOf = (hook) => (hook && hook.type === 'command' ? `${hook.command || ''}\u0000${(hook.args || []).join('\u0000')}` : JSON.stringify(hook));

/**
 * Returns `{ text, added }`: the merged file text (2-space JSON, trailing
 * newline) and the list of "Event: command" entries that were added. `text`
 * is null when either side isn't valid JSON, so the caller can fall back to
 * the plain conflict handling.
 */
export function mergeSettings(localText, incomingText) {
  let local, incoming;
  try { local = JSON.parse(localText); incoming = JSON.parse(incomingText); } catch { return { text: null, added: [] }; }
  if (!local || typeof local !== 'object' || Array.isArray(local)) return { text: null, added: [] };
  const wanted = incoming && incoming.hooks && typeof incoming.hooks === 'object' ? incoming.hooks : {};

  const added = [];
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
  return { text: JSON.stringify(local, null, 2) + '\n', added };
}
