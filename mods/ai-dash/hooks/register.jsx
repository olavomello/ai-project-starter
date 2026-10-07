// ai-dash — optional, off by default (see mods/ai-dash/README.md).
//
// Measures real per-task usage (tokens, cache, tool calls, duration) and:
//   1. hands it to ai-project-starter's log pipeline via a small usage file
//      (`.agents/state/usage/<branch>.json`), so `ai-log.mjs` stops seeing
//      zeros when an agent forgot to export AILOG_* vars;
//   2. draws a 1-3 line band above the prompt with the running total, cache
//      ratio, last gate result and live agent count.
//
// Static-analysis rule: `$` is only ever passed to a function declared at
// the top level of this file. All such functions below take the session
// state they need as plain arguments and return plain data — no closures
// over mutable session state. `register()` below holds that mutable state
// and calls these functions explicitly. Pure arithmetic/formatting (no `$`
// at all) lives in hooks/lib/*.js so it can be unit-tested without the
// engine. Every hook fails open: a thrown error here must never block a
// tool call, a prompt, or a turn.

import { atom, read, update } from 'claude-code';

import { join, dirname } from './lib/path.js';
import { sanitizeBranch, agentNameFromBranch } from './lib/branch.js';
import { zeroCounters, addUsage, freshTokens, cacheRatio } from './lib/usage.js';
import { parseBudgetKnob, ceilingFor } from './lib/knobs.js';
import { formatBandSegments, gateStatusText, spinnerSuffix, kilo } from './lib/band.js';
import { buildPrompt, parseItems, removeLine, toEntries, windowEntries } from './lib/decisions-parse.js';
import { DASH_LABEL, dashUrl, dashProbeUrl, isAiDash, openCommands, startArgv } from './lib/dash.js';
import { UPDATE_LABEL, UPDATING_LABEL, CHECK_EVERY_MS, checkArgv, applyArgv, shutdownInit, parseCheck, updateView, updatedToast } from './lib/update.js';

const MAX_AGENTS = 4;
// Band icon colours by tone, as theme colours so they follow the user's theme like the Pending decisions band.
const TONE_COLOR = { ok: 'success', warn: 'warning', bad: 'error', plain: 'suggestion' };

// ---- the AI Dash button ----

/** Is this project's ai-dash answering on its port? (Not just any program on that port.) */
async function dashRunning($) {
  try {
    const r = await $.http.fetch(dashProbeUrl());
    return r.ok && isAiDash(r.text);
  } catch {
    return false;
  }
}

/** Opens `url` in the default browser, trying the Windows, macOS and Linux openers in turn. */
async function openBrowser($, url) {
  for (const argv of openCommands(url)) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 15000 });
      if (r.exitCode === 0) return true;
    } catch { /* that opener does not exist on this OS; try the next */ }
  }
  return false;
}

/** Starts scripts/ai-dash.mjs for the session's life: the child ends with the session or the module. */
function startDash($, root) {
  void (async () => {
    try {
      for await (const piece of $.process.spawn({ argv: startArgv(), cwd: root })) void piece;
    } catch { /* it could not start, or it stopped; the button reports it */ }
  })();
}

/** Button handler: make sure the dashboard is running, starting it if not, then open it in the browser. */
async function openDash($, root) {
  try {
    if (!root || !(await fileExists($, join(root, 'scripts', 'ai-dash.mjs')))) {
      $.ui.toast('AI Dash: scripts/ai-dash.mjs not found in this project (run ai-project-starter update)');
      return;
    }
    if (!(await dashRunning($))) {
      $.ui.toast('AI Dash: starting the dashboard…');
      startDash($, root);
      for (let i = 0; i < 24 && !(await dashRunning($)); i++) await $.clock.sleep(250);
      if (!(await dashRunning($))) {
        $.ui.toast('AI Dash did not start on port 4173. Run it yourself: node scripts/ai-dash.mjs');
        return;
      }
    }
    if (!(await openBrowser($, dashUrl()))) $.ui.toast(`AI Dash is running: open ${dashUrl()}`);
  } catch {
    $.ui.toast('AI Dash: could not start or open the dashboard');
  }
}

// ---- the "Update available" button ----

/** Polls `condition()` every `ms` up to `tries` times; true as soon as it holds. */
async function waitFor($, condition, tries, ms) {
  for (let i = 0; i < tries; i++) {
    if (await condition()) return true;
    await $.clock.sleep(ms);
  }
  return condition();
}

/** Stops a running dashboard (a running process keeps the old code) and starts it again. */
async function restartDash($, root) {
  try { await $.http.fetch(`${dashUrl()}api/shutdown`, shutdownInit()); } catch { /* it may drop the connection as it exits */ }
  await waitFor($, async () => !(await dashRunning($)), 12, 250);
  startDash($, root);
  return waitFor($, () => dashRunning($), 24, 250);
}

/** Asks the project's scripts/ais-update.mjs whether a newer starter exists; null when it cannot tell. */
async function checkForUpdate($, root, force) {
  try {
    if (!(await fileExists($, join(root, 'scripts', 'ais-update.mjs')))) return null;
    const r = await $.process.run(checkArgv(force), { cwd: root, timeoutMs: 45000 });
    return parseCheck(r.stdout);
  } catch {
    return null;
  }
}

/** Runs the update and, if the dashboard was running, restarts it on the new code. True on success. */
async function applyStarterUpdate($, root) {
  const dashWasRunning = await dashRunning($);
  $.ui.toast('AIS: updating…');
  try {
    const r = await $.process.run(applyArgv(), { cwd: root, timeoutMs: 600000 });
    if (r.exitCode !== 0) {
      $.ui.toast('AIS update failed. Run it to see why: node scripts/ais-update.mjs apply');
      return false;
    }
    const restarted = dashWasRunning ? await restartDash($, root) : false;
    $.ui.toast(updatedToast(restarted));
    return true;
  } catch {
    $.ui.toast('AIS update could not run: node scripts/ais-update.mjs apply');
    return false;
  }
}

/** Re-reads the update check into `state` and redraws the band; `force` skips the script's 30 minute cache. */
async function refreshUpdate($, root, state, force) {
  if (!root) return;
  state.lastCheck = await $.clock.now();
  const info = await checkForUpdate($, root, force);
  if (info) state.info = info;
  $.ui.invalidate('ui.render');
}

/** The button's handler: update, restart the dashboard if it ran, then re-check so the button clears. */
async function runUpdate($, root, state) {
  if (state.updating || !root) return;
  state.updating = true;
  $.ui.invalidate('ui.render');
  try {
    if (await applyStarterUpdate($, root)) await refreshUpdate($, root, state, true);
  } finally {
    state.updating = false;
    $.ui.invalidate('ui.render');
  }
}

function usageFilePath(root, safeBranch) {
  return join(root, '.agents', 'state', 'usage', `${safeBranch}.json`);
}
function gateAttemptsPath(root, safeBranch) {
  return join(root, '.agents', 'state', 'gate-attempts', safeBranch);
}

/** git branch + shared root, or null if this isn't a git repo. */
async function gitInfo($) {
  try {
    const common = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (common.exitCode !== 0 || !common.stdout.trim()) return null;
    const sharedRoot = dirname(common.stdout.trim());
    const br = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = br.exitCode === 0 ? br.stdout.trim() : 'unknown';
    return { root: sharedRoot, branch: branchName || 'unknown' };
  } catch { return null; }
}

async function fileExists($, path) {
  try { return await $.fs.exists(path); } catch { return false; }
}

async function readBudgetKnob($, cwd) {
  try {
    const text = await $.fs.read(join(cwd, 'AGENTS.md'));
    return parseBudgetKnob(text);
  } catch { return null; }
}

async function countLiveAgents($, root) {
  try {
    const entries = await $.fs.list(join(root, '.agents', 'worktrees'));
    return Array.isArray(entries) ? entries.length : 0;
  } catch { return 0; }
}

async function readGateAttempts($, root, safeBranch) {
  try {
    const path = gateAttemptsPath(root, safeBranch);
    if (!(await fileExists($, path))) return 0;
    const text = (await $.fs.read(path)).trim();
    const n = parseInt(text, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

/** Reads the usage file (if any), adds `patch`, writes it back. Fails open. */
async function mergeUsageDelta($, root, safeBranch, patch) {
  try {
    const path = usageFilePath(root, safeBranch);
    let existing = null;
    if (await fileExists($, path)) {
      try { existing = JSON.parse(await $.fs.read(path)); } catch { existing = null; }
    }
    const base = existing || {
      uncached_in: 0, cache_read: 0, cache_write: 0, out: 0,
      tool_calls: 0, duration_s: 0, model: null, size: null,
    };
    const merged = {
      uncached_in: base.uncached_in + (patch.uncached_in || 0),
      cache_read: base.cache_read + (patch.cache_read || 0),
      cache_write: base.cache_write + (patch.cache_write || 0),
      out: base.out + (patch.out || 0),
      tool_calls: base.tool_calls + (patch.tool_calls || 0),
      duration_s: base.duration_s + (patch.duration_s || 0),
      model: patch.model !== undefined ? patch.model : base.model,
      size: patch.size !== undefined ? patch.size : base.size,
    };
    await $.fs.write(path, JSON.stringify(merged));
  } catch { /* fail open — a lost delta is better than a blocked session */ }
}

function bestModelOf(modelTotals) {
  let top = null, topVal = -1;
  for (const [m, v] of modelTotals) if (v > topVal) { top = m; topVal = v; }
  return top;
}

function tokensOf(usage) {
  return (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
}

async function askOrLogBudgetReached($, taskSize, fresh, ceiling, turnId) {
  const msg = `Budget ${taskSize} reached (${kilo(fresh)} of ${kilo(ceiling)}). Continue?`;
  try {
    const choice = await $.ui.ask(msg, ['Continue', 'Stop']);
    if (choice === 'Stop') { await $.turn.abort({ turnId }); }
  } catch {
    $.ui.log(`ai-dash: Budget ${taskSize} reached (${kilo(fresh)} of ${kilo(ceiling)}) — advisory only, continuing.`);
  }
}

// ---- the Pending decisions band and pane ----
// Shown only when the project has the markdown file the decisions live in (default
// docs/pending-decisions.md); without it the band stays hidden.
//   band : `◆ Pending decisions : 14`, a row of coloured squares (one per item, one colour per section),
//          and two buttons on the right: Refresh and View.
//   pane : the items as a list, each with an Approve button and a one-line detail. Approve asks for a
//          confirmation, then hands the item to the agent as a prompt and removes its row from the file.
//   /pending opens the pane from the prompt. The file is watched, so a change by you or by the agent
//   reaches the band within a second or two, and right after any tool call.

const DEC_PANE = 'decisions';

const decItems = atom({ plugin: 'ai-dash', key: 'decisionItems' }, []);
const decScreen = atom({ plugin: 'ai-dash', key: 'decisionScreen' }, { kind: 'list' });
const decOffset = atom({ plugin: 'ai-dash', key: 'decisionOffset' }, 0);
const decStatus = atom({ plugin: 'ai-dash', key: 'decisionStatus' }, {
  exists: false,
  stamp: '',
  checkedAt: 0,
  error: null,
});

/** One decAccent per section, so the bar in the band and the headings in the pane agree. */
const DEC_ACCENTS = ['suggestion', 'warning', 'permission', 'success'];
const decAccent = (group) => DEC_ACCENTS[group % DEC_ACCENTS.length] || 'suggestion';

const DEC_LIST = { kind: 'list' };
const decConfirming = (id) => ({ kind: 'confirm', id });

const decClock = (ms) => {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

let decTimer;
let decBusy = false;
let decRoot = null; // the project's shared git root, once known: where AI Dash queues the items it approves

const DEC_INBOX = '.agents/state/decisions-inbox.jsonl';

/**
 * Hands the session the prompts AI Dash queued when the Administrator approved an item there. The queue is
 * claimed (emptied) before anything is sent, so a prompt is never sent twice by this session.
 */
async function decDrainInbox($) {
  const path = decRoot ? join(decRoot, DEC_INBOX) : DEC_INBOX;
  try {
    if (!(await $.fs.exists(path))) return;
    const entries = [];
    for (const line of String(await $.fs.read(path)).split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry.prompt === 'string' && entry.prompt !== '') entries.push(entry);
      } catch { /* a torn or foreign line is skipped */ }
    }
    if (!entries.length) return; // nothing queued: leave the file alone
    await $.fs.write(path, '');
    for (const entry of entries) {
      void $.prompt.submit({ text: entry.prompt });
      $.ui.toast(`Approved in AI Dash: ${entry.title || 'a decision'}`);
    }
  } catch { /* the next read asks again */ }
}

const DEC_DEFAULT_FILE = 'docs/pending-decisions.md';

/** Reads the file and replaces the list. Never throws: a failure becomes the decStatus line. */
async function decLoad($, file) {
  await decDrainInbox($);
  const checkedAt = await $.clock.now();
  try {
    if (!(await $.fs.exists(file))) {
      await update($, decItems, () => []);
      await update($, decStatus, () => ({ exists: false, stamp: '', checkedAt, error: null }));
      return;
    }
    const [text, stat] = await Promise.all([$.fs.read(file), $.fs.stat(file)]);
    const list = parseItems(String(text));
    await update($, decItems, () => list);
    await update($, decStatus, () => ({
      exists: true,
      stamp: `${stat.mtimeMs}:${stat.size}`,
      checkedAt,
      error: null,
    }));
    // A refresh can drop the item a confirmation was about, or shrink the list under the window.
    await update($, decScreen, (current) =>
      current.kind === 'confirm' && !list.some((item) => item.id === current.id) ? DEC_LIST : current,
    );
    await update($, decOffset, (current) => Math.min(current, Math.max(list.length * 2, 0)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update($, decStatus, (previous) => ({ ...previous, checkedAt, error: message }));
  }
}

/** The cheap decCheck the decTimer and the tool hook run: reload only when the file changed. */
async function decCheck($, file) {
  if (decBusy) return;
  await decDrainInbox($);
  try {
    const present = await $.fs.exists(file);
    const known = await read($, decStatus);
    if (!present) {
      if (known.exists) await decLoad($, file);
      return;
    }
    const stat = await $.fs.stat(file);
    if (!known.exists || known.stamp !== `${stat.mtimeMs}:${stat.size}`) await decLoad($, file);
  } catch {
    // the next period asks again
  }
}

async function decOpenPane($, file) {
  await update($, decScreen, () => ({ kind: 'list' }));
  await update($, decOffset, () => 0);
  await decLoad($, file);
  await $.ui.open({ id: DEC_PANE, title: 'Pending decisions', focus: true, closeOnEscape: true });
}

/** Hands the item to the agent first, then takes its row out of the file. */
async function decApprove($, file, id) {
  decBusy = true;
  try {
    const item = (await read($, decItems)).find((one) => one.id === id);
    await update($, decScreen, () => ({ kind: 'list' }));
    if (!item) return;
    const markdown = String(await $.fs.read(file));
    const next = removeLine(markdown, item.raw);
    if (next === null) {
      $.ui.toast('That item changed on disk. The list was refreshed.');
      return;
    }
    void $.prompt.submit({ text: buildPrompt(item, file) });
    await $.fs.write(file, next);
    $.ui.toast(`Sent to the agent: ${item.title}`);
  } catch (error) {
    $.ui.toast(`Could not approve: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    decBusy = false;
    await decLoad($, file);
  }
}

function decReadConfig(options) {
  const opts = options || {};
  return {
    file: typeof opts.file === 'string' && opts.file !== '' ? opts.file : DEC_DEFAULT_FILE,
    pollMs: Math.max(250, Number(opts.pollMs) || 1500),
    showWhenMissing: opts.showWhenMissing === true,
  };
}

let decConfig = decReadConfig();

/** Session start: register /pending, read the file once and start watching it. */
async function startDecisions($) {
  // A command name another plugin already owns must never break the rest of the mod.
  try {
    await $.command.register({ name: 'pending', description: 'Review the pending decisions and approve one' });
  } catch { /* the band and pane still work without the slash command */ }
  await decLoad($, decConfig.file);
  if (decTimer) decTimer.cancel();
  decTimer = $.clock.every(decConfig.pollMs, () => {
    void decCheck($, decConfig.file);
  });
}

/** Session end: stop watching. */
function stopDecisions() {
  if (decTimer) decTimer.cancel();
  decTimer = undefined;
}

/** The agent often edits the file itself: look right after any tool call instead of waiting a period. */
function noteToolCall($) {
  void decCheck($, decConfig.file);
}

/**
 * The Pending decisions row, drawn above `rest` (what the plugins below draw). Returns `rest` untouched
 * when the project has no decisions file, so a project without it never sees the band.
 */
async function decisionsBand($, e, rest) {
  if (e.props.hasSurvey) return rest;
  const known = await read($, decStatus);
  if (!known.exists && !decConfig.showWhenMissing) return rest; // no decisions file in this project: nothing to show

  const list = await read($, decItems);
  const { Box, Text, Button } = $.ui.resolve(e);
  const { file } = decConfig;
  const count = list.length;
  const tone = !known.exists ? 'error' : count === 0 ? 'success' : 'warning';

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" paddingX={1}>
        <Box gap={1}>
          <Text color={tone}>{count === 0 && known.exists ? '\u25c7' : '\u25c6'}</Text>
          <Text bold>Pending decisions : {known.exists ? count : 'file not found'}</Text>
          {known.exists && count > 0 && (
            <Text>
              {list.slice(0, 24).map((item) => (
                <Text color={decAccent(item.group)}>{'\u25aa'}</Text>
              ))}
              {count > 24 && <Text dimColor>+{count - 24}</Text>}
            </Text>
          )}
        </Box>
        <Box gap={2}>
          <Button key="refresh" label={'\u21bb Refresh'} hotkey="r" dimColor onPress={() => decLoad($, file)} />
          <Button key="view" label={'View \u203a'} hotkey="v" variant="primary" onPress={() => decOpenPane($, file)} />
        </Box>
      </Box>
      {rest}
    </Box>
  );
}

/** The hooks only this part owns: the /pending command and the pane. The rest is called from the mod's own hooks. */
function registerDecisions(on, options) {
  decConfig = decReadConfig(options);
  const { file } = decConfig;

  on('command.run', { command: 'pending' }, async ($) => {
    await decOpenPane($, file);
    return { text: 'Pending decisions opened.' };
  });

  on('ui.render', { component: 'Pane', requestId: DEC_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const list = await read($, decItems);
    const known = await read($, decStatus);
    const current = await read($, decScreen);
    const start = await read($, decOffset);
    const close = () => $.ui.close({ id: DEC_PANE });

    const header = (title, onClose, withRefresh) => (
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text color="warning">{'◆'}</Text>
          <Text bold>{title}</Text>
          {withRefresh && <Text dimColor>{list.length}</Text>}
        </Box>
        <Box gap={2}>
          {withRefresh && (
            <Button key="pane-refresh" label={'↻ Refresh'} hotkey="r" dimColor onPress={() => decLoad($, file)} />
          )}
          <Button key="pane-close" label={'✕ Close'} hotkey="x" dimColor onPress={onClose} />
        </Box>
      </Box>
    );

    if (current.kind === 'confirm') {
      const item = list.find((one) => one.id === current.id);
      const back = () => update($, decScreen, () => ({ kind: 'list' }));
      if (!item) {
        return <Box flexDirection="column">{header('Confirm approval', back, false)}</Box>;
      }
      return (
        <Box flexDirection="column" gap={1}>
          {header('Confirm approval', back, false)}
          <Box flexDirection="column" borderStyle="round" borderColor={decAccent(item.group)} paddingX={1}>
            <Text bold>{item.title}</Text>
            {item.detail !== '' && <Text dimColor>{item.detail}</Text>}
            {item.blocks !== '' && <Text color={decAccent(item.group)}>Blocks · {item.blocks}</Text>}
          </Box>
          <Text bold>Confirm approval?</Text>
          <Text dimColor>The agent receives this item to execute it, then it leaves the list.</Text>
          <Box gap={2}>
            <Button key="confirm-yes" label="Y  Yes" hotkey="y" variant="primary" onPress={() => decApprove($, file, item.id)} />
            <Button key="confirm-no" label="N  No" hotkey="n" onPress={back} />
          </Box>
        </Box>
      );
    }

    const room = Math.max(6, ((e.viewport && e.viewport.rows) || 24) - 8);
    const entries = toEntries(list);
    const { shown, start: from, end } = windowEntries(entries, start, room);
    const isPaged = from > 0 || end < entries.length;

    return (
      <Box flexDirection="column" gap={1}>
        {header('Pending decisions', close, true)}
        {!known.exists && <Text color="error">File not found: {file}</Text>}
        {known.error !== null && <Text color="error">{known.error}</Text>}
        {known.exists && list.length === 0 && <Text color="success">{'✓'} All clear. Nothing waits on you.</Text>}
        <Box flexDirection="column">
          {shown.map((entry) =>
            entry.kind === 'heading' ? (
              <Box key={`h:${entry.group}:${entry.text}`} flexDirection="column">
                <Box gap={1}>
                  <Text color={decAccent(entry.group)}>{'▍'}</Text>
                  <Text bold color={decAccent(entry.group)}>
                    {entry.text.toUpperCase()}
                  </Text>
                  <Text dimColor>{entry.count}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {'─'.repeat(120)}
                </Text>
              </Box>
            ) : (
              <Box key={entry.item.id} flexDirection="column" marginBottom={1}>
                <Box justifyContent="space-between" gap={2}>
                  <Box flexGrow={1} flexShrink={1} gap={1}>
                    <Text color={decAccent(entry.item.group)}>{'●'}</Text>
                    <Text bold wrap="truncate-end">
                      {entry.item.title}
                    </Text>
                  </Box>
                  <Button
                    key={`approve:${entry.item.id}`}
                    label={'✓ Approve'}
                    variant="primary"
                    onPress={() => update($, decScreen, () => decConfirming(entry.item.id))}
                  />
                </Box>
                {entry.item.detail !== '' && (
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {entry.item.detail}
                  </Text>
                )}
                {entry.item.blocks !== '' && (
                  <Text color={decAccent(entry.item.group)} wrap="truncate-end">
                    {'  ↳ blocks · '}
                    {entry.item.blocks}
                  </Text>
                )}
              </Box>
            ),
          )}
        </Box>
        {isPaged && (
          <Box gap={2}>
            <Button
              key="page-up"
              label={'▲'}
              dimColor
              onPress={() => update($, decOffset, () => Math.max(0, from - Math.max(1, shown.length - 1)))}
            />
            <Button key="page-down" label={'▼'} dimColor onPress={() => update($, decOffset, () => Math.min(entries.length - 1, end))} />
            <Text dimColor>
              {from + 1}–{end} of {entries.length}
            </Text>
          </Box>
        )}
        <Text dimColor>
          {known.checkedAt > 0 ? `Updated ${decClock(known.checkedAt)} · ` : ''}watching {file}
        </Text>
      </Box>
    );
  });
}

export const register = (on, options) => {
  // ---- session-lifetime state (plain closures over `register`, never
  // passed to the top-level `$`-touching functions above — those take it as
  // explicit arguments instead, per the static-analysis rule) ----
  let inert = true;
  let root = null;           // shared git root (parent of --git-common-dir)
  let branch = 'main';
  let safeBranch = 'main';
  let agent = 'main';
  let budgetKnob = null;     // {S,M,L} or null ("off")
  let taskSize = null;       // 'S' | 'M' | 'L' | null
  let counters = zeroCounters();
  const modelTotals = new Map();
  let toolCalls = 0;
  let gateText = null;       // last known gate status line, or null
  const updateState = { info: null, updating: false, lastCheck: 0 }; // the update button: last check, busy flag
  let warned80 = false;
  let warned100 = false;

  // ---- session.start: establish identity, decide inert, register /budget ----
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    try { await startDecisions($); } catch { /* the decisions band is optional */ }
    try {
      const info = await gitInfo($);
      const hasGate = info ? await fileExists($, join(info.root, 'scripts/gate.sh')) : false;
      if (!info || !hasGate) { inert = true; return result; }

      root = info.root;
      decRoot = root;
      branch = info.branch;
      safeBranch = sanitizeBranch(branch);
      agent = agentNameFromBranch(branch);
      budgetKnob = await readBudgetKnob($, e.cwd);
      inert = false;
      void refreshUpdate($, root, updateState, false);

      await $.command.register({
        name: 'budget',
        description: "Show or set this task's token budget: /budget S|M|L|off",
      });
    } catch {
      inert = true;
    }
    return result;
  });

  // ---- /budget S|M|L|off, or /budget alone to show status ----
  on('command.run', { command: 'budget' }, async ($, e, next) => {
    if (inert) return next(e);
    const arg = (e.args || '').trim().toUpperCase();
    const ceiling = ceilingFor(budgetKnob, taskSize);

    if (!arg) {
      const fresh = freshTokens(counters);
      if (!taskSize) {
        return { text: budgetKnob
          ? `No task size set. Usage so far: ${kilo(fresh)} fresh tokens. Set one with /budget S|M|L|off.`
          : 'Task budget knob is off for this project (AGENTS.md section 0). /budget still tracks usage, just with no ceiling.' };
      }
      return { text: ceiling
        ? `Budget ${taskSize}: ${kilo(fresh)} / ${kilo(ceiling)} fresh tokens.`
        : `Task size ${taskSize} set, but the budget knob has no value for it.` };
    }
    if (arg === 'OFF') {
      taskSize = null; warned80 = false; warned100 = false;
      return { text: 'Task budget off.' };
    }
    if (['S', 'M', 'L'].includes(arg)) {
      taskSize = arg; warned80 = false; warned100 = false;
      counters = zeroCounters();
      const newCeiling = ceilingFor(budgetKnob, taskSize);
      return { text: newCeiling
        ? `Task size set to ${arg} (ceiling ${kilo(newCeiling)} fresh tokens).`
        : `Task size set to ${arg} (no ceiling configured for it).` };
    }
    return { text: 'Usage: /budget S|M|L|off, or /budget alone to show status.' };
  });

  // ---- usage + pre-request budget check ----
  on('turn.step', async function* ($, e, next) {
    if (inert) { return yield* next(e); }

    try {
      const ceiling = ceilingFor(budgetKnob, taskSize);
      if (ceiling) {
        const fresh = freshTokens(counters);
        const ratio = fresh / ceiling;
        if (ratio >= 1 && !warned100) {
          warned100 = true;
          await askOrLogBudgetReached($, taskSize, fresh, ceiling, e.turnId);
        } else if (ratio >= 0.8 && !warned80) {
          warned80 = true;
          $.ui.toast(`Budget ${taskSize} at ${Math.round(ratio * 100)}%`);
        }
      }
    } catch { /* budget check is advisory — never block the step */ }

    const result = yield* next(e);

    try {
      if (result && result.usage) {
        counters = addUsage(counters, result.usage);
        if (result.usage.model) {
          modelTotals.set(result.usage.model, (modelTotals.get(result.usage.model) || 0) + tokensOf(result.usage));
        }
        await mergeUsageDelta($, root, safeBranch, {
          uncached_in: result.usage.input_tokens || 0,
          cache_read: result.usage.cache_read_input_tokens || 0,
          cache_write: result.usage.cache_creation_input_tokens || 0,
          out: result.usage.output_tokens || 0,
          model: bestModelOf(modelTotals),
          size: taskSize,
        });
        $.ui.invalidate('ui.render');
      }
    } catch { /* fail open */ }

    return result;
  });

  // ---- tool-call count + gate status (never rewrites the command) ----
  on('session.end', ($, e, next) => {
    stopDecisions();
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    noteToolCall($);
    if (inert) return next(e);

    const isGateCall = e.tool === 'Bash'
      && typeof e.command === 'string'
      && (e.command.includes('scripts/gate.sh') || e.command.includes('agent-team.sh finish'));

    const prior = isGateCall ? await readGateAttempts($, root, safeBranch) : 0;

    const result = await next(e);

    try {
      toolCalls += 1;
      await mergeUsageDelta($, root, safeBranch, { tool_calls: 1 });

      if (isGateCall) {
        const stillFailing = await fileExists($, gateAttemptsPath(root, safeBranch));
        const post = stillFailing ? await readGateAttempts($, root, safeBranch) : null;
        gateText = gateStatusText(prior, post);
      }
      $.ui.invalidate('ui.render');
    } catch { /* fail open */ }

    return result;
  });

  // ---- duration bookkeeping ----
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (inert) return result;
    try {
      const seconds = Math.round((e.durationMs || 0) / 1000);
      await mergeUsageDelta($, root, safeBranch, { duration_s: seconds });
      if (!updateState.updating && (await $.clock.now()) - updateState.lastCheck > CHECK_EVERY_MS) void refreshUpdate($, root, updateState, false);
    } catch { /* fail open */ }
    return result;
  });

  // ---- the band ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    let rest = below;
    try { rest = await decisionsBand($, e, below); } catch { rest = below; } // the Pending decisions row, when the project has its file
    if (inert) return rest;
    try {
      const { Box, Text, Button } = $.ui.resolve(e);
      const agentsCount = await countLiveAgents($, root);
      const ceiling = ceilingFor(budgetKnob, taskSize);
      const segments = formatBandSegments({
        agent,
        size: taskSize,
        fresh: freshTokens(counters),
        ceiling,
        cacheRatioVal: cacheRatio(counters),
        gateText,
        agentsCount,
        maxAgents: MAX_AGENTS,
      });
      const buttons = [<Button key="aidash" label={DASH_LABEL} hotkey="d" dimColor onPress={() => openDash($, root)} />];
      const view = updateView(updateState.info, updateState.updating);
      if (view === 'available') buttons.push(<Button key="update" label={UPDATE_LABEL} hotkey="u" variant="primary" onPress={() => runUpdate($, root, updateState)} />);
      if (view === 'updating') buttons.push(<Text key="updating" dimColor>{UPDATING_LABEL}</Text>);
      // Same pattern as the Pending decisions band: a coloured icon and a plain label on the left, buttons
      // with a hotkey on the right. The band shares this slot with other plugins' rows, so it keeps to its
      // own line (items wrap under each other on a narrow window instead of drawing over a neighbour) and
      // the buttons never shrink.
      return (
        <Box flexDirection="column">
          <Box flexWrap="wrap" justifyContent="space-between" columnGap={2} paddingX={1} marginBottom={1}>
            <Box gap={2} flexShrink={1}>
              {segments.map((seg) => (
                <Box key={seg.key} gap={1}>
                  <Text color={TONE_COLOR[seg.tone]}>{seg.icon}</Text>
                  <Text bold={seg.key === 'branch'}>{seg.text}</Text>
                </Box>
              ))}
            </Box>
            <Box gap={2} flexShrink={0}>{buttons}</Box>
          </Box>
          {rest}
        </Box>
      );
    } catch {
      return rest;
    }
  });

  // ---- spinner suffix ----
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (inert || toolCalls === 0) return next(e);
    try {
      return next({ ...e, props: { ...e.props, suffix: spinnerSuffix(toolCalls) } });
    } catch {
      return next(e);
    }
  });

  // The Pending decisions band, pane and /pending: drawn below the band above, only where the file exists.
  registerDecisions(on, options);
};
