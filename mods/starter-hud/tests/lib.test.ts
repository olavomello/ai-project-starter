// Pure-logic tests for hooks/lib/*.js — no `$`, no engine. These run under
// `claude plugin test` alongside the engine-backed tests in this folder, but
// need none of its kit since the modules under test never touch `$`.
import { test, expect } from 'claude-code/testing';

import { sanitizeBranch, agentNameFromBranch } from '../hooks/lib/branch.js';
import {
  zeroCounters, addUsage, totalInput, freshTokens, cacheRatio,
} from '../hooks/lib/usage.js';
import { parseBudgetKnob, ceilingFor } from '../hooks/lib/knobs.js';
import { formatBandLines, gateStatusText, spinnerSuffix, kilo } from '../hooks/lib/band.js';
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

test('formatBandLines: every state', () => {
  expect(formatBandLines({
    agent: 'dev-api-tester', size: 'M', fresh: 49200, ceiling: 60000,
    cacheRatioVal: 0.78, gateText: 'gate passed, first try', agentsCount: 2, maxAgents: 4,
  })).toEqual([
    'dev-api-tester · task M',
    'tokens 49.2k / 60k · cache 78%',
    'gate passed, first try · agents 2/4',
  ]);

  // no size set, no ceiling, no cache yet, gate never ran, no live agents
  expect(formatBandLines({
    agent: 'main', size: null, fresh: 1200, ceiling: null,
    cacheRatioVal: null, gateText: null, agentsCount: 0, maxAgents: 4,
  })).toEqual(['main', 'tokens 1.2k']);
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
