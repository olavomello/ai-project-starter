// Pure helpers, no `$`. Text formatting for the AbovePrompt band (one row of icon + text
// segments) and the Spinner suffix. Kept separate from register.jsx so the formatting
// rules can be unit-tested without the engine.

// Plain Unicode symbols that a terminal font or the desktop app both draw (no emoji, no icon font).
export const ICONS = {
  branch: '⎇', // branch / agent
  tokens: '◆', // tokens used
  cache: '↻', // cache reuse
  gatePass: '✓',
  gateFail: '✗',
  size: '▣', // task size
  agents: '◎', // live agents
};
export const SEPARATOR = '  '; // the row draws its items with gap={2}; the width estimate below counts it

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
 * The band as one row of segments, each an icon plus a short text. All inputs are plain data.
 * Order is also priority: when the row would be wider than `maxWidth`, segments are dropped
 * from the end (agents, then task size, then gate...) until it fits; the branch and the
 * tokens always stay.
 *
 * @param {object} p
 * @param {string} p.agent
 * @param {string|null} p.size        'S'|'M'|'L'|'off'|null
 * @param {number} p.fresh            fresh-token count (see usage.js freshTokens)
 * @param {number|null} p.ceiling     budget ceiling for `size`, or null
 * @param {number|null} p.cacheRatioVal  0..1, or null before the first request
 * @param {string|null} p.gateText    result of gateStatusText(...), or null if the gate hasn't run
 * @param {number} p.agentsCount      live agent worktrees
 * @param {number} p.maxAgents
 * @param {object} [o]
 * @param {number} [o.maxWidth=100]   widest row, in characters, before low-priority segments go
 * @returns {{key: string, icon: string, text: string, tone: 'ok'|'warn'|'bad'|'plain'}[]}
 */
export function formatBandSegments(p, { maxWidth = 100 } = {}) {
  const segments = [{ key: 'branch', icon: ICONS.branch, text: p.agent, tone: 'plain' }];

  let tokensTone = 'plain';
  if (p.ceiling != null && p.ceiling > 0) {
    if (p.fresh >= p.ceiling) tokensTone = 'bad';
    else if (p.fresh >= p.ceiling * 0.8) tokensTone = 'warn';
  }
  segments.push({
    key: 'tokens', icon: ICONS.tokens, tone: tokensTone,
    text: p.ceiling != null ? `tokens ${kilo(p.fresh)} / ${kilo(p.ceiling)}` : `tokens ${kilo(p.fresh)}`,
  });

  if (p.cacheRatioVal != null) {
    segments.push({ key: 'cache', icon: ICONS.cache, text: `cache ${Math.round(p.cacheRatioVal * 100)}%`, tone: 'plain' });
  }
  if (p.gateText) {
    const failed = p.gateText.startsWith('gate failed');
    segments.push({ key: 'gate', icon: failed ? ICONS.gateFail : ICONS.gatePass, text: p.gateText, tone: failed ? 'bad' : 'ok' });
  }
  if (p.size && p.size !== 'off') segments.push({ key: 'size', icon: ICONS.size, text: `task ${p.size}`, tone: 'plain' });
  if (p.agentsCount > 0) segments.push({ key: 'agents', icon: ICONS.agents, text: `agents ${p.agentsCount}/${p.maxAgents}`, tone: 'plain' });

  const width = (list) => list.reduce((n, s, i) => n + s.icon.length + 1 + s.text.length + (i ? SEPARATOR.length : 0), 0);
  while (segments.length > 2 && width(segments) > maxWidth) segments.pop();
  return segments;
}

/** The Spinner suffix: " · N tool calls", or '' when N is 0. */
export function spinnerSuffix(toolCalls) {
  return toolCalls > 0 ? ` · ${toolCalls} tool calls` : '';
}
