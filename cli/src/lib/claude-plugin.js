// Talks to the `claude` CLI to install and check the optional ai-dash plugin.
//
// Enabling the mod only writes `.claude/settings.json`; Claude Code does not
// download a plugin because a project's settings enable it, so the plugin has to
// be installed once per machine. `init` and `doctor --fix` do that here, and
// `doctor` checks it. Every function takes an injectable `run` so tests never
// touch the real Claude Code installation.
import { spawnSync } from 'node:child_process';

export const MOD_PLUGIN = 'ai-dash';
export const MARKETPLACE = 'ai-project-starter';
export const MOD_ID = `${MOD_PLUGIN}@${MARKETPLACE}`;
// The plugin was called starter-hud before it became ai-dash; projects and machines may still have that name.
export const LEGACY_MOD_ID = 'starter-hud@ai-project-starter';
export const MARKETPLACE_REPO = 'olavomello/ai-project-starter';

/** Runs `claude <args>`. Never throws: `{ ok, stdout, stderr, missing }`. */
export function runClaude(args, { cwd, timeout = 180000 } = {}) {
  // On Windows `claude` is a .cmd shim, which only a shell can start. Hand the shell one
  // command string (not an args array, which Node warns about) and quote each argument.
  const quote = (a) => (/^[\w./#@:=-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '')}"`);
  const r = process.platform === 'win32'
    ? spawnSync(['claude', ...args].map(quote).join(' '), { cwd, encoding: 'utf8', timeout, shell: true })
    : spawnSync('claude', args, { cwd, encoding: 'utf8', timeout });
  return {
    ok: r.status === 0 && !r.error,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    missing: Boolean(r.error && r.error.code === 'ENOENT') || (process.platform === 'win32' && r.status === 1 && /not recognized/i.test(r.stderr || '')),
  };
}

export function claudeAvailable(run = runClaude) {
  const r = run(['--version']);
  return r.ok && !r.missing;
}

/** The two commands that install the mod, for messages and for manual use. */
export function installCommands(ref = 'main') {
  return [
    `claude plugin marketplace add ${MARKETPLACE_REPO}#${ref}`,
    `claude plugin install ${MOD_ID} --scope project`,
  ];
}

/**
 * Is the mod installed for the project at `cwd`? `true` / `false`, or `null` when
 * the `claude` CLI is unavailable or its answer can't be read.
 */
export function modInstalled(cwd, run = runClaude) {
  const r = run(['plugin', 'list', '--json'], { cwd });
  if (!r.ok) return null;
  try {
    const list = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
    return list.some((p) => p.id === MOD_ID && (p.enabled || p.projectEnabled));
  } catch { return null; }
}

/**
 * Adds the marketplace and installs the mod at project scope.
 * Returns `{ ok, steps, manual }`; `manual` lists the commands to run by hand when it fails.
 */
export function installMod({ cwd, ref = 'main', run = runClaude }) {
  const [addCmd, installCmd] = installCommands(ref);
  const steps = [];
  const add = run(['plugin', 'marketplace', 'add', `${MARKETPLACE_REPO}#${ref}`], { cwd });
  const addOk = add.ok || /already/i.test(add.stdout + add.stderr); // re-adding an existing marketplace is fine
  steps.push({ cmd: addCmd, ok: addOk, detail: (add.stderr || add.stdout).trim().split('\n')[0] || '' });
  if (!addOk) return { ok: false, steps, manual: [addCmd, installCmd] };
  // Pick up what the marketplace gained since it was added (a renamed or new plugin); a failure is not fatal.
  run(['plugin', 'marketplace', 'update', MARKETPLACE], { cwd });
  const install = run(['plugin', 'install', MOD_ID, '--scope', 'project'], { cwd });
  const installOk = install.ok || /already installed/i.test(install.stdout + install.stderr);
  steps.push({ cmd: installCmd, ok: installOk, detail: (install.stderr || install.stdout).trim().split('\n')[0] || '' });
  return { ok: installOk, steps, manual: installOk ? [] : [installCmd] };
}

/** Is the old starter-hud plugin still installed for the project at `cwd`? `true` / `false`, or `null` when it can't be read. */
export function legacyInstalled(cwd, run = runClaude) {
  const r = run(['plugin', 'list', '--json'], { cwd });
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('['))).some((p) => p.id === LEGACY_MOD_ID);
  } catch { return null; }
}

/** Removes the old starter-hud plugin (project scope). Returns `{ ok, cmd, detail }`. */
export function uninstallLegacy({ cwd, run = runClaude }) {
  const r = run(['plugin', 'uninstall', LEGACY_MOD_ID, '--scope', 'project'], { cwd });
  return { ok: r.ok, cmd: `claude plugin uninstall ${LEGACY_MOD_ID} --scope project`, detail: (r.stderr || r.stdout).trim().split('\n')[0] || '' };
}
