// Pure-logic tests for hooks/lib/*.js — no `$`, no engine. These run under
// `claude plugin test` alongside the engine-backed tests in this folder, but
// need none of its kit since the modules under test never touch `$`.
import { test, expect } from 'claude-code/testing';

import { sanitizeBranch, agentNameFromBranch } from '../hooks/lib/branch.js';
import {
  zeroCounters, addUsage, totalInput, freshTokens, cacheRatio,
} from '../hooks/lib/usage.js';
import { parseBudgetKnob, ceilingFor } from '../hooks/lib/knobs.js';
import { formatBandSegments, gateStatusText, spinnerSuffix, kilo, ICONS, SEPARATOR } from '../hooks/lib/band.js';
import { DASH_LABEL, dashUrl, dashProbeUrl, isAiDash, openCommands, startArgv } from '../hooks/lib/dash.js';
import { UPDATE_LABEL, UPDATING_LABEL, CHECK_EVERY_MS, checkArgv, applyArgv, shutdownInit, parseCheck, updateView, updatedToast } from '../hooks/lib/update.js';
import { join, dirname } from '../hooks/lib/path.js';

test('sanitizeBranch matches the gate.sh printf rule, no trailing underscore', () => {
  expect(sanitizeBranch('agent/dev-api-tester')).toBe('agent_dev-api-tester');
  expect(sanitizeBranch('feature/x.y')).toBe('feature_x.y');
});

test('agentNameFromBranch', () => {
  expect(agentNameFromBranch('agent/dev-api-tester')).toBe('dev-api-tester');
  expect(agentNameFromBranch('main')).toBe('main');
  expect(agentNameFromBranch('feat/session-mod')).toBe('main');
});

test('usage accumulation across several turn.step-shaped readings', () => {
  let c = zeroCounters();
  c = addUsage(c, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 });
  c = addUsage(c, { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 150, cache_creation_input_tokens: 0 });
  expect(c).toEqual({ uncached_in: 300, cache_read: 200, cache_write: 10, out: 50 });
  expect(totalInput(c)).toBe(510);
  expect(freshTokens(c)).toBe(360); // uncached_in + cache_write + out
  expect(Math.abs(cacheRatio(c) - 200 / 510) < 1e-9).toBe(true);
});

test('cacheRatio is null before the first request', () => {
  expect(cacheRatio(zeroCounters())).toBeNull();
});

test('parseBudgetKnob: off and missing both read as no budget', () => {
  expect(parseBudgetKnob('| Task token budget S / M / L | off |')).toBeNull();
  expect(parseBudgetKnob('no such row here')).toBeNull();
});

test('parseBudgetKnob: a real value', () => {
  const knob = parseBudgetKnob('| Task token budget S / M / L | 40000 / 120000 / 300000 |');
  expect(knob).toEqual({ S: 40000, M: 120000, L: 300000 });
  expect(ceilingFor(knob, 'M')).toBe(120000);
  expect(ceilingFor(knob, null)).toBeNull();
  expect(ceilingFor(null, 'M')).toBeNull();
});

test('kilo formatting', () => {
  expect(kilo(60000)).toBe('60k');
  expect(kilo(49200)).toBe('49.2k');
  expect(kilo(500)).toBe('500');
  expect(kilo(1250000)).toBe('1.3M');
});

test('gateStatusText', () => {
  expect(gateStatusText(0, null)).toBe('gate passed, first try');
  expect(gateStatusText(2, null)).toBe('gate passed');
  expect(gateStatusText(0, 1)).toBe('gate failed (attempt 1)');
  expect(gateStatusText(1, 2)).toBe('gate failed (attempt 2)');
});

const row = (segments: { icon: string; text: string }[]) => segments.map((x) => `${x.icon} ${x.text}`).join(SEPARATOR);

test('formatBandSegments: one row, an icon before every piece of information', () => {
  const full = formatBandSegments({
    agent: 'dev-api-tester', size: 'M', fresh: 49200, ceiling: 60000,
    cacheRatioVal: 0.78, gateText: 'gate passed, first try', agentsCount: 2, maxAgents: 4,
  }, { maxWidth: 200 });
  expect(full.map((x) => x.key)).toEqual(['branch', 'tokens', 'cache', 'gate', 'size', 'agents']);
  expect(full.every((x) => x.icon.length > 0)).toBe(true);
  expect(row(full)).toBe(
    `${ICONS.branch} dev-api-tester${SEPARATOR}${ICONS.tokens} tokens 49.2k / 60k${SEPARATOR}${ICONS.cache} cache 78%` +
    `${SEPARATOR}${ICONS.gatePass} gate passed, first try${SEPARATOR}${ICONS.size} task M${SEPARATOR}${ICONS.agents} agents 2/4`,
  );

  // no size set, no ceiling, no cache yet, gate never ran, no live agents: just branch and tokens
  const lean = formatBandSegments({
    agent: 'main', size: null, fresh: 1200, ceiling: null,
    cacheRatioVal: null, gateText: null, agentsCount: 0, maxAgents: 4,
  });
  expect(row(lean)).toBe(`${ICONS.branch} main${SEPARATOR}${ICONS.tokens} tokens 1.2k`);
});

test('formatBandSegments: tones follow the budget and the gate', () => {
  const base = { agent: 'main', size: 'S', cacheRatioVal: null, gateText: null, agentsCount: 0, maxAgents: 4 };
  const tone = (p: object, key: string) => formatBandSegments({ ...base, ...p } as never).find((x) => x.key === key)?.tone;
  expect(tone({ fresh: 10000, ceiling: 60000 }, 'tokens')).toBe('plain');
  expect(tone({ fresh: 50000, ceiling: 60000 }, 'tokens')).toBe('warn'); // 80% of the ceiling
  expect(tone({ fresh: 60000, ceiling: 60000 }, 'tokens')).toBe('bad');
  expect(tone({ fresh: 999999, ceiling: null }, 'tokens')).toBe('plain'); // no ceiling, nothing to warn about
  expect(tone({ fresh: 1, ceiling: null, gateText: 'gate passed' }, 'gate')).toBe('ok');
  const failed = formatBandSegments({ ...base, fresh: 1, ceiling: null, gateText: 'gate failed (attempt 2)' } as never).find((x) => x.key === 'gate');
  expect([failed?.tone, failed?.icon]).toEqual(['bad', ICONS.gateFail]);
});

test('formatBandSegments: a narrow budget drops the low-priority segments first, never branch or tokens', () => {
  const p = {
    agent: 'dev-api-tester', size: 'M', fresh: 49200, ceiling: 60000,
    cacheRatioVal: 0.78, gateText: 'gate passed, first try', agentsCount: 2, maxAgents: 4,
  };
  expect(formatBandSegments(p).map((x) => x.key)).toEqual(['branch', 'tokens', 'cache', 'gate', 'size']); // default width 100
  expect(formatBandSegments(p, { maxWidth: 90 }).map((x) => x.key)).toEqual(['branch', 'tokens', 'cache', 'gate']);
  expect(formatBandSegments(p, { maxWidth: 60 }).map((x) => x.key)).toEqual(['branch', 'tokens', 'cache']);
  expect(formatBandSegments(p, { maxWidth: 1 }).map((x) => x.key)).toEqual(['branch', 'tokens']);
});

test('spinnerSuffix', () => {
  expect(spinnerSuffix(0)).toBe('');
  expect(spinnerSuffix(3)).toBe(' · 3 tool calls');
});

test('path helpers: join and dirname (no Node builtins allowed in a mod)', () => {
  expect(join('/root', '.agents', 'state', 'usage', 'main.json')).toBe('/root/.agents/state/usage/main.json');
  expect(dirname('/a/b/.git')).toBe('/a/b');
  expect(dirname('/a')).toBe('/');
});

test('AI Dash button helpers: url, probe, recognising our dashboard, per-OS openers', () => {
  expect(dashUrl()).toBe('http://127.0.0.1:4173/');
  expect(dashProbeUrl()).toBe('http://127.0.0.1:4173/api/config');
  expect(dashUrl(5000)).toBe('http://127.0.0.1:5000/');
  expect(isAiDash('{"mod":{"enabled":true,"source":"project","ref":"main"}}')).toBe(true);
  expect(isAiDash('{"mod":{"enabled":null}}')).toBe(true);
  expect(isAiDash('<html>another app</html>')).toBe(false);
  expect(isAiDash('{"hello":1}')).toBe(false);
  expect(isAiDash('{"mod":null}')).toBe(false);
  expect(isAiDash('')).toBe(false);
  expect(openCommands('http://x/')).toEqual([
    ['cmd', '/c', 'start', '', 'http://x/'],
    ['open', 'http://x/'],
    ['xdg-open', 'http://x/'],
  ]);
  expect(startArgv()).toEqual(['node', 'scripts/ai-dash.mjs', '--port', '4173']);
  expect(DASH_LABEL.endsWith('AI Dash')).toBe(true);
});

test('update button helpers: what to run, reading the answer, what to show', () => {
  expect(checkArgv()).toEqual(['node', 'scripts/ais-update.mjs', 'check', '--json']);
  expect(checkArgv(true)).toEqual(['node', 'scripts/ais-update.mjs', 'check', '--json', '--force']);
  expect(applyArgv()).toEqual(['node', 'scripts/ais-update.mjs', 'apply']);
  expect(shutdownInit()).toEqual({ method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-dash': '1' }, body: '{}' });

  expect(parseCheck('{"available":true,"current":"abc1234","latest":"def5678","checkedAt":1}')).toEqual({ available: true, current: 'abc1234', latest: 'def5678' });
  expect(parseCheck('noise on top\n{"available":false,"current":"abc1234","latest":"abc1234"}\n')).toEqual({ available: false, current: 'abc1234', latest: 'abc1234' });
  expect(parseCheck('{"available":"yes"}')).toBe(null);
  expect(parseCheck('not json')).toBe(null);
  expect(parseCheck('')).toBe(null);

  expect(updateView(null, false)).toBe('idle');
  expect(updateView({ available: false, current: 'a', latest: 'a' }, false)).toBe('idle');
  expect(updateView({ available: true, current: 'a', latest: 'b' }, false)).toBe('available');
  expect(updateView({ available: true, current: 'a', latest: 'b' }, true)).toBe('updating');
  expect(updateView(null, true)).toBe('updating');

  expect(UPDATE_LABEL.endsWith('Update available')).toBe(true);
  expect(UPDATING_LABEL.includes('Updating')).toBe(true);
  expect(CHECK_EVERY_MS).toBe(600000);
  expect(updatedToast(true)).toContain('dashboard restarted');
  expect(updatedToast(false)).not.toContain('dashboard restarted');
});
