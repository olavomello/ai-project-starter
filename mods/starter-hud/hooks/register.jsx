// starter-hud — optional, off by default (see mods/starter-hud/README.md).
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

import { join, dirname } from './lib/path.js';
import { sanitizeBranch, agentNameFromBranch } from './lib/branch.js';
import { zeroCounters, addUsage, freshTokens, cacheRatio } from './lib/usage.js';
import { parseBudgetKnob, ceilingFor } from './lib/knobs.js';
import { formatBandSegments, gateStatusText, spinnerSuffix, kilo, SEPARATOR } from './lib/band.js';
import { DASH_LABEL, dashUrl, dashProbeUrl, isAiDash, openCommands, startArgv } from './lib/dash.js';
import { UPDATE_LABEL, UPDATING_LABEL, CHECK_EVERY_MS, checkArgv, applyArgv, shutdownInit, parseCheck, updateView, updatedToast } from './lib/update.js';

const MAX_AGENTS = 4;
// Band icon colours by tone; a tone with no colour draws dim like the text.
const TONE_COLOR = { ok: 'green', warn: 'yellow', bad: 'red' };

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
    $.ui.log(`starter-hud: Budget ${taskSize} reached (${kilo(fresh)} of ${kilo(ceiling)}) — advisory only, continuing.`);
  }
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
    try {
      const info = await gitInfo($);
      const hasGate = info ? await fileExists($, join(info.root, 'scripts/gate.sh')) : false;
      if (!info || !hasGate) { inert = true; return result; }

      root = info.root;
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
  on('tool.call', async ($, e, next) => {
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
    const rest = await next(e);
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
      const row = [];
      segments.forEach((s, i) => {
        const color = TONE_COLOR[s.tone];
        if (i > 0) row.push(<Text key={s.key + 's'} dimColor>{SEPARATOR}</Text>);
        row.push(color ? <Text key={s.key + 'i'} color={color}>{s.icon}</Text> : <Text key={s.key + 'i'} dimColor>{s.icon}</Text>);
        row.push(<Text key={s.key + 't'} dimColor>{' ' + s.text}</Text>);
      });
      const buttons = [<Button key="aidash" label={DASH_LABEL} onPress={() => openDash($, root)} />];
      const view = updateView(updateState.info, updateState.updating);
      if (view === 'available') buttons.push(<Box key="updatebox" marginLeft={2}><Button key="update" label={UPDATE_LABEL} onPress={() => runUpdate($, root, updateState)} /></Box>);
      if (view === 'updating') buttons.push(<Box key="updatingbox" marginLeft={2}><Text dimColor>{UPDATING_LABEL}</Text></Box>);
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Box>{row}</Box>
            <Box>{buttons}</Box>
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

  void options; // userConfig is unused by this mod; part of the Register signature
};
