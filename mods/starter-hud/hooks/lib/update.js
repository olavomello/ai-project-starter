// Pure helpers for the "Update available" button: what to run, how to read its answer, what to show.
// No `$` here, so the rules can be unit-tested without the engine.

export const UPDATE_LABEL = '↑ Update available'; // ↑ Update available
export const UPDATING_LABEL = '↻ Updating…'; // ↻ Updating…
export const CHECK_EVERY_MS = 10 * 60 * 1000; // how often a turn may trigger a check (the script also caches 30 min)

/** Asks scripts/ais-update.mjs whether a newer starter exists. */
export function checkArgv(force = false) {
  return ['node', 'scripts/ais-update.mjs', 'check', '--json', ...(force ? ['--force'] : [])];
}

/** Runs the project's update (the CLI via npx), then refreshes the plugin and re-checks. */
export function applyArgv() {
  return ['node', 'scripts/ais-update.mjs', 'apply'];
}

/** The request that makes the dashboard exit, so it can be started again on the new code. */
export function shutdownInit() {
  return { method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-dash': '1' }, body: '{}' };
}

/**
 * Reads the JSON the check prints (its last line, so a stray log line above it does not matter).
 * Returns `{ available, current, latest }` or null when there is nothing usable.
 */
export function parseCheck(stdout) {
  const lines = String(stdout || '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const r = JSON.parse(lines[i]);
      if (r && typeof r === 'object' && typeof r.available === 'boolean') {
        return { available: r.available, current: r.current || null, latest: r.latest || null };
      }
    } catch { /* not the JSON line; keep looking upwards */ }
  }
  return null;
}

/** 'idle' draws nothing; 'available' draws the button; 'updating' draws the busy label. */
export function updateView(info, updating) {
  if (updating) return 'updating';
  return info && info.available ? 'available' : 'idle';
}

/** The toast after an update: what happened and what to do next. */
export function updatedToast(restartedDash) {
  return `AIS updated${restartedDash ? ', dashboard restarted' : ''}. Commit the changes so worktrees get them; start a new session to load a new mod version.`;
}
