// Tests for the page's desktop bridge: notifications and tray status, run through the page's own code.
//
// Run: node --test cli/test/desktop-bridge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../template/ai-dash/index.html', import.meta.url)), 'utf8');
const start = html.indexOf('// Desktop shell:');
const code = html.slice(start, html.indexOf('})();', start) + 5);

function harness({ shell = true, stored = null, throwing = false } = {}) {
  const calls = { notify: [], status: [] };
  const listeners = {};
  const store = new Map(stored === null ? [] : [['ai-dash-desktop-notify', stored]]);
  const row = { hidden: true };
  const sw = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.click = fn; } };
  const countEl = { hidden: true, textContent: '' };
  let observer;
  const ctx = {
    window: shell ? { aiDashDesktop: { notify: (t, b) => { if (throwing) throw new Error('gone'); calls.notify.push([t, b]); }, setStatus: (s) => { if (throwing) throw new Error('gone'); calls.status.push(JSON.parse(JSON.stringify(s))); } } } : {},
    document: {
      getElementById: (id) => ({ 'desktop-row': row, 'desktop-notify': sw, 'decisions-count': countEl }[id] || null),
      addEventListener: (type, fn) => { listeners[type] = fn; },
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    parseInt, String, Map, Math, Array,
  };
  vm.runInNewContext(code, ctx);
  return {
    calls, row, sw, store,
    live: (running, recent = []) => listeners['live-state']?.({ detail: { offline: false, running: running.length, state: { running, recent } } }),
    decisions: (n) => { countEl.hidden = n === 0; countEl.textContent = String(n); observer?.(); },
    hasListener: () => Boolean(listeners['live-state']),
  };
}
const run = (id, type = 'dev-web-builder') => ({ id, type, since: 0, seconds: 5 });

test('without the desktop shell the bridge does nothing at all', () => {
  const h = harness({ shell: false });
  assert.equal(h.hasListener(), false);
  assert.equal(h.row.hidden, true);
});

test('with the shell, the Settings row shows and the first poll only sets a baseline', () => {
  const h = harness();
  assert.equal(h.row.hidden, false);
  assert.equal(h.sw.attrs['aria-checked'], 'true');
  h.live([run('a1')]);
  assert.deepEqual(h.calls.notify, [], 'agents already running when the window opened are not announced');
  assert.deepEqual(h.calls.status.at(-1), { running: 1, decisions: 0 });
});

test('an agent that stops raises one notification with its name and how long it took', () => {
  const h = harness();
  h.live([run('a1'), run('a2', 'dev-api-builder')]);
  h.live([run('a2', 'dev-api-builder')], [{ id: 'a1', type: 'dev-web-builder', seconds: 192 }]);
  assert.deepEqual(h.calls.notify, [['dev-web-builder finished', 'took 3 min']]);
  h.live([run('a2', 'dev-api-builder')]);
  assert.equal(h.calls.notify.length, 1, 'it is announced once, not at every poll');
});

test('a main session turn is named, and background runs (type unknown) are not announced', () => {
  const h = harness();
  h.live([run('s:1', 'main'), run('bg', 'unknown')]);
  h.live([], [{ id: 's:1', type: 'main', seconds: 42 }, { id: 'bg', type: 'unknown', seconds: 1 }]);
  assert.deepEqual(h.calls.notify, [['Main session finished', 'took 42 s']]);
});

test('pending decisions notify only when the number grows', () => {
  const h = harness();
  h.decisions(3);
  assert.deepEqual(h.calls.notify, [['3 pending decisions', 'Open AI Dash to review them.']]);
  h.decisions(2);
  assert.equal(h.calls.notify.length, 1, 'fewer is good news, not a notification');
  h.decisions(3);
  assert.equal(h.calls.notify.length, 2);
  h.decisions(0);
  h.decisions(1);
  assert.equal(h.calls.notify.at(-1)[0], '1 pending decision');
});

test('the switch turns notifications off and the choice is remembered', () => {
  const h = harness();
  h.live([run('a1')]);
  h.sw.click();
  assert.equal(h.store.get('ai-dash-desktop-notify'), '0');
  assert.equal(h.sw.attrs['aria-checked'], 'false');
  h.live([], [{ id: 'a1', type: 'dev-web-builder', seconds: 9 }]);
  h.decisions(5);
  assert.deepEqual(h.calls.notify, []);
  assert.equal(harness({ stored: '0' }).sw.attrs['aria-checked'], 'false', 'a new window starts with the saved choice');
  h.sw.click();
  assert.equal(h.sw.attrs['aria-checked'], 'true');
});

test('a shell that throws never breaks the page', () => {
  const h = harness({ throwing: true });
  assert.doesNotThrow(() => { h.live([run('a1')]); h.live([], [{ id: 'a1', type: 'dev-web-builder', seconds: 3 }]); h.decisions(2); });
});
