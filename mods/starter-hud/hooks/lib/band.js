// Pure helpers — no `$`. Text formatting for the AbovePrompt band and the
// Spinner suffix. Kept separate from register.jsx so the formatting rules
// can be unit-tested without the engine.

/** 49200 -> "49.2k", 60000 -> "60k", 1_250_000 -> "1.3M", 500 -> "500". */
export function kilo(n) {
  if (n == null || !Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = (s) => s.replace(/\.0$/, '');
  if (abs >= 1e6) return sign + trim((abs / 1e6).toFixed(1)) + 'M';
  if (abs >= 1e3) return sign + trim((abs / 1e3).toFixed(1)) + 'k';
  return sign + String(abs);
}

/**
 * The gate-status fragment for line 3.
 * @param prior   consecutive-failure count read BEFORE this gate run (0 if none/missing)
 * @param post    consecutive-failure count read AFTER this gate run (null if the file
 *                is now missing, i.e. the gate passed)
 */
export function gateStatusText(prior, post) {
  if (post === null || post === undefined) {
    return prior === 0 ? 'gate passed, first try' : 'gate passed';
  }
  return `gate failed (attempt ${post})`;
}

/**
 * Builds the (at most 3) text lines of the band, before any UI wrapping.
 * All inputs are plain data — no `$`, no engine types.
 *
 * @param {object} p
 * @param {string} p.agent
 * @param {string|null} p.size        'S'|'M'|'L'|'off'|null
 * @param {number} p.fresh            fresh-token count (see usage.js freshTokens)
 * @param {number|null} p.ceiling     budget ceiling for `size`, or null
 * @param {number|null} p.cacheRatioVal  0..1, or null before the first request
 * @param {string|null} p.gateText    result of gateStatusText(...), or null if the
 *                                    gate hasn't run this session
 * @param {number} p.agentsCount      live agent worktrees
 * @param {number} p.maxAgents
 * @returns {string[]} 1 to 3 lines
 */
export function formatBandLines(p) {
  const hasSize = p.size && p.size !== 'off';
  const line1 = hasSize ? `${p.agent} · task ${p.size}` : p.agent;

  const tokensPart = p.ceiling != null
    ? `tokens ${kilo(p.fresh)} / ${kilo(p.ceiling)}`
    : `tokens ${kilo(p.fresh)}`;
  const cachePart = p.cacheRatioVal == null ? '' : ` · cache ${Math.round(p.cacheRatioVal * 100)}%`;
  const line2 = tokensPart + cachePart;

  const line3Parts = [];
  if (p.gateText) line3Parts.push(p.gateText);
  if (p.agentsCount > 0) line3Parts.push(`agents ${p.agentsCount}/${p.maxAgents}`);
  const line3 = line3Parts.join(' · ');

  return line3 ? [line1, line2, line3] : [line1, line2];
}

/** The Spinner suffix: " · N tool calls", or '' when N is 0. */
export function spinnerSuffix(toolCalls) {
  return toolCalls > 0 ? ` · ${toolCalls} tool calls` : '';
}
