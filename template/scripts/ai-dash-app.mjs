#!/usr/bin/env node
// Opens AI Dash in its own window.
//
//   node scripts/ai-dash-app.mjs [--detach] [--no-shell] [--browser] [--port N] [--no-update]
//   node scripts/ai-dash-app.mjs --print       start the server if needed and print the URL
//   node scripts/ai-dash-app.mjs --check       what is installed, and is there a newer shell (--json for machines)
//   node scripts/ai-dash-app.mjs --update      look for a newer shell now and install it
//
// It starts this project's `scripts/ai-dash.mjs` (or reuses the one already answering) on a port taken from
// the project's identity, then opens a window with the first of these that works:
//   1. the desktop shell, a small native program downloaded once per machine from this starter's GitHub
//      Releases and kept up to date (docs/adr/0005 explains why and how);
//   2. app mode of Edge or Chrome (a window without tabs or address bar; nothing to download);
//   3. the default browser.
// Dependency-free Node, like the other scripts, so it runs the same on Windows, macOS and Linux.
//
// Environment: AI_DASH_HOME (cache folder), AI_DASH_NO_SHELL=1, AI_DASH_NO_UPDATE=1, AI_DASH_NO_APPMODE=1 (skip Edge/Chrome
// app mode). For tests and forks: AIS_DESKTOP_REPO (owner/name), AIS_DESKTOP_API (releases list URL),
// AIS_DESKTOP_DOWNLOAD_PREFIX (the only URL prefix a download may come from).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, chmodSync,
  openSync, readSync, closeSync, realpathSync,
} from 'node:fs';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { usageRoot } from './skills.mjs';

export const REPO = process.env.AIS_DESKTOP_REPO || 'olavomello/ai-project-starter';
export const RELEASES_API = process.env.AIS_DESKTOP_API || `https://api.github.com/repos/${REPO}/releases?per_page=30`;
export const DOWNLOAD_PREFIX = process.env.AIS_DESKTOP_DOWNLOAD_PREFIX || `https://github.com/${REPO}/releases/download/`;
export const TAG_PREFIX = 'desktop-v';
export const CHECK_MS = 24 * 60 * 60 * 1000; // look for a newer shell at most once a day
export const RETRY_MS = 60 * 60 * 1000; // after a failed look, try again in an hour
export const MAX_BYTES = 64 * 1024 * 1024; // a shell is a few MB; anything near this is wrong
const PORT_BASE = 4300;
const PORT_SPAN = 600;
const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

const log = (msg) => console.log(`ai-dash-app: ${msg}`);

// ---------------------------------------------------------------- identity, paths, platform

/** The port for a project: the same for every worktree of it (so one window per project), 4300 to 4899. */
export function portFor(identity, platform = process.platform) {
  let key = String(identity).replace(/\\/g, '/').replace(/\/+$/, '');
  if (platform === 'win32') key = key.toLowerCase(); // Windows paths ignore case
  return PORT_BASE + (createHash('sha256').update(key).digest().readUInt32BE(0) % PORT_SPAN);
}

/** Where the machine-wide cache lives: one copy of the shell for every project on this machine. */
export function cacheHome(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AI_DASH_HOME) return resolve(env.AI_DASH_HOME);
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ai-project-starter', 'desktop');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'ai-project-starter', 'desktop');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'ai-project-starter', 'desktop');
}

/** The release target for this machine, or null where no shell is offered (Linux, Windows on ARM). */
export function targetOf(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'mac-x64';
  return null;
}

export const binaryName = (platform = process.platform) => (platform === 'win32' ? 'ai-dash-desktop.exe' : 'ai-dash-desktop');

export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// ---------------------------------------------------------------- releases

/**
 * The newest published `desktop-vX.Y.Z` release that carries a latest.json, or null:
 * `{ version, tag, latestUrl, latestApiUrl, assets: [{ name, apiUrl }] }`. The API urls are what a private repository needs.
 */
export function pickRelease(releases) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string' || !r.tag_name.startsWith(TAG_PREFIX)) continue;
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!SEMVER.test(version)) continue;
    const asset = (r.assets || []).find((a) => a && a.name === 'latest.json' && typeof a.browser_download_url === 'string');
    if (!asset) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = {
        version, tag: r.tag_name, latestUrl: asset.browser_download_url, latestApiUrl: typeof asset.url === 'string' ? asset.url : null,
        assets: (r.assets || []).filter((a) => a && typeof a.name === 'string' && typeof a.url === 'string').map((a) => ({ name: a.name, apiUrl: a.url })),
      };
    }
  }
  return best;
}

/** Checks a latest.json and returns the entry for `target`. Throws with a reason when anything is off. */
export function validateLatest(latest, target, prefix = DOWNLOAD_PREFIX) {
  if (!latest || typeof latest !== 'object') throw new Error('latest.json is not an object');
  if (!SEMVER.test(String(latest.version))) throw new Error('latest.json has no valid version');
  const entry = latest.assets && latest.assets[target];
  if (!entry || typeof entry !== 'object') throw new Error(`latest.json has nothing for ${target}`);
  const { name, url, sha256, size } = entry;
  if (typeof name !== 'string' || !FILE_NAME.test(name)) throw new Error('asset name is not a plain file name');
  if (typeof url !== 'string' || !url.startsWith(prefix)) throw new Error(`asset URL is not under ${prefix}`);
  if (typeof sha256 !== 'string' || !HEX64.test(sha256)) throw new Error('asset sha256 is not 64 hex characters');
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) throw new Error('asset size is out of range');
  return { version: latest.version, name, url, sha256, size };
}

async function getJson(url, fetchImpl, { headers = {}, timeoutMs = 8000 } = {}) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'ai-project-starter', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Downloads to `dest`, refusing more bytes than `size` and a hash other than `sha256`. */
export async function download(url, dest, { size, sha256, fetchImpl = fetch, timeoutMs = 120000, headers = {} }) {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'ai-project-starter', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  const hash = createHash('sha256');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (bytes > size) throw new Error('download is larger than latest.json says');
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (bytes !== size) throw new Error(`download is ${bytes} bytes, latest.json says ${size}`);
  if (hash.digest('hex') !== sha256) throw new Error('download does not match the published SHA-256');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.concat(chunks));
}

export function hashFile(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1 << 16);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) hash.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

// ---------------------------------------------------------------- the cache

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * The installed shell: `{ version, binary }`, or `{ error }` when current.json points at something missing or
 * changed (the hash is checked on every start), or null when nothing is installed.
 */
export function readCurrent(home) {
  const cur = readJson(join(home, 'current.json'));
  if (!cur || !SEMVER.test(String(cur.version)) || typeof cur.binary !== 'string' || !HEX64.test(String(cur.sha256))) return null;
  const binary = resolve(home, cur.binary);
  if (!binary.startsWith(resolve(home) + sep)) return { error: 'current.json points outside the cache' };
  if (!existsSync(binary)) return { error: 'the installed shell is missing' };
  if (hashFile(binary) !== cur.sha256) return { error: 'the installed shell was changed after it was installed' };
  return { version: cur.version, binary };
}

/** Installs one verified release into `<home>/<version>/` and makes it current. Returns `{ version, binary }`. */
export async function installShell({ entry, home, platform = process.platform, fetchImpl = fetch, headers = {} }) {
  // Built in a scratch folder and swapped in at the end, so a failed download never removes a working install.
  const dir = join(home, `.tmp-${entry.version}`);
  const part = join(dir, `${entry.name}.part`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    await download(entry.url, part, { size: entry.size, sha256: entry.sha256, fetchImpl, headers });
    let binary = join(dir, binaryName(platform));
    if (entry.name.endsWith('.tar.gz')) {
      // relative paths and cwd: a GNU tar on Windows would read "C:\..." as host:path
      const r = spawnSync('tar', ['-xzf', basename(part)], { cwd: dir, stdio: 'ignore' });
      if (r.status !== 0) throw new Error('could not unpack the archive (is tar installed?)');
      rmSync(part, { force: true });
    } else {
      renameSync(part, binary);
    }
    if (!existsSync(binary)) throw new Error(`the release does not contain ${binaryName(platform)}`);
    if (platform !== 'win32') chmodSync(binary, 0o755);
    const final = join(home, entry.version);
    rmSync(final, { recursive: true, force: true });
    renameSync(dir, final);
    binary = join(final, binaryName(platform));
    const old = readJson(join(home, 'current.json'));
    writeJsonAtomic(join(home, 'current.json'), {
      version: entry.version,
      binary: `${entry.version}/${binaryName(platform)}`,
      sha256: hashFile(binary),
      installedAt: new Date().toISOString(),
      previous: old && SEMVER.test(String(old.version)) && old.version !== entry.version ? old.version : null,
    });
    prune(home, entry.version);
    return { version: entry.version, binary };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Keeps the current and the previous version folders, removes the rest. */
export function prune(home, current) {
  const cur = readJson(join(home, 'current.json'));
  const keep = new Set([current, cur && cur.previous].filter(Boolean));
  for (const e of readdirSync(home, { withFileTypes: true })) {
    if (!e.isDirectory() || !SEMVER.test(e.name) || keep.has(e.name)) continue;
    // best effort: Windows refuses to delete a program that is still running, and that must not fail the update
    try { rmSync(join(home, e.name), { recursive: true, force: true }); } catch { /* removed on a later update */ }
  }
}

export function shouldCheck(home, now = Date.now()) {
  const c = readJson(join(home, 'check.json'));
  return !c || typeof c.nextCheck !== 'number' || now >= c.nextCheck;
}

/**
 * Looks for a newer shell and installs it. `force` skips the once-a-day throttle.
 * Returns `{ status }`: skipped, no-release, current, updated (with version) or failed (with error).
 */
/**
 * A GitHub token for a private repository: GH_TOKEN or GITHUB_TOKEN, else the one the `gh` CLI is signed in with.
 * Only asked for after public access answered 401, 403 or 404, and only ever sent to the releases API host.
 */
export function readToken(env = process.env, run = spawnSync) {
  const given = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (given) return given;
  try {
    const r = run('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
    const t = r && r.status === 0 ? String(r.stdout).trim() : '';
    return /^[A-Za-z0-9_]{20,}$/.test(t) ? t : null;
  } catch { return null; }
}

export async function updateShell({ home, target, platform = process.platform, force = false, now = Date.now(), fetchImpl = fetch, api = RELEASES_API, prefix = DOWNLOAD_PREFIX, token: tokenFor = readToken }) {
  if (!target) return { status: 'skipped', reason: 'no shell for this platform' };
  if (!force && !shouldCheck(home, now)) return { status: 'skipped', reason: 'checked recently' };
  try {
    // Public first. A private repository answers 401/403/404 to that; then the signed-in user's token is used, and
    // only for requests to the API's own host (a download is redirected elsewhere without it).
    const origin = new URL(api).origin;
    let token = null;
    const authFor = (url) => (token && url.startsWith(`${origin}/`) ? { authorization: `Bearer ${token}` } : {});
    const get = (url, accept) => getJson(url, fetchImpl, { headers: { accept, ...authFor(url) } });
    let releases;
    try {
      releases = await get(api, 'application/vnd.github+json');
    } catch (e) {
      if (!/answered (401|403|404)$/.test(e.message)) throw e;
      token = typeof tokenFor === 'function' ? tokenFor() : tokenFor;
      if (!token) throw new Error(`${e.message} (if the repository is private, set GH_TOKEN or sign in with the gh CLI)`);
      releases = await get(api, 'application/vnd.github+json');
    }
    const release = pickRelease(releases);
    writeJsonAtomic(join(home, 'check.json'), { checkedAt: now, nextCheck: now + CHECK_MS, latest: release ? release.version : null });
    if (!release) return { status: 'no-release' };
    const cur = readCurrent(home);
    if (cur && cur.version && compareVersions(cur.version, release.version) >= 0) return { status: 'current', version: cur.version };
    const latestUrl = token ? release.latestApiUrl : release.latestUrl;
    if (!latestUrl || !(token ? latestUrl.startsWith(`${origin}/`) : latestUrl.startsWith(prefix))) throw new Error(`latest.json is not under ${token ? origin : prefix}`);
    const entry = validateLatest(await get(latestUrl, token ? 'application/octet-stream' : 'application/json'), target, prefix);
    if (entry.version !== release.version) throw new Error('latest.json and the release tag disagree on the version');
    let from = entry.url;
    if (token) {
      const asset = release.assets.find((a) => a.name === entry.name);
      if (!asset || !asset.apiUrl.startsWith(`${origin}/`)) throw new Error(`the release has no ${entry.name} on ${origin}`);
      from = asset.apiUrl;
    }
    const done = await installShell({ entry: { ...entry, url: from }, home, platform, fetchImpl, headers: token ? { ...authFor(from), accept: 'application/octet-stream' } : {} });
    return { status: 'updated', version: done.version };
  } catch (e) {
    try { writeJsonAtomic(join(home, 'check.json'), { checkedAt: now, nextCheck: now + RETRY_MS, error: String(e.message || e).slice(0, 200) }); } catch { /* the cache may be unwritable */ }
    return { status: 'failed', error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------- fallbacks: Edge or Chrome app mode, the browser

/** Edge or Chrome (or Chromium) on this machine, or null. `exists` is injectable for tests. */
export function findBrowser(platform = process.platform, env = process.env, exists = existsSync) {
  const candidates = [];
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) candidates.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const r of roots) candidates.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else if (platform === 'darwin') {
    for (const app of ['Microsoft Edge', 'Google Chrome', 'Chromium']) candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
  } else {
    for (const dir of String(env.PATH || '').split(':').filter(Boolean)) {
      for (const bin of ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser']) candidates.push(join(dir, bin));
    }
  }
  return candidates.find((c) => exists(c)) || null;
}

/** Arguments that give a window without tabs or address bar, in a profile folder of its own. */
export function browserArgs(url, profileDir) {
  return [`--app=${url}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1360,900'];
}

/** How to open `url` in the default browser on each OS (no shell involved), tried in order. */
export function openCommands(url) {
  return [['cmd', '/c', 'start', '', url], ['open', url], ['xdg-open', url]];
}

// ---------------------------------------------------------------- the server

const isDashAnswer = (text) => { try { const b = JSON.parse(text); return Boolean(b && typeof b === 'object' && b.mod && typeof b.mod === 'object'); } catch { return false; } };

/** True when AI Dash itself answers on `port` (not just any program on it). */
export async function probe(port, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(1200) });
    return res.ok && isDashAnswer(await res.text());
  } catch { return false; }
}

/** Makes sure the project's dash answers on `port`. Returns `{ started }`. */
export async function ensureServer(root, port, { fetchImpl = fetch, waitMs = 10000 } = {}) {
  if (await probe(port, fetchImpl)) return { started: false };
  const script = join(root, 'scripts', 'ai-dash.mjs');
  if (!existsSync(script)) throw new Error(`${script} not found`);
  const child = spawn(process.execPath, [script, '--port', String(port)], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150));
    if (await probe(port, fetchImpl)) return { started: true };
  }
  throw new Error(`the dash did not answer on port ${port} (is something else using it? try --port)`);
}

async function stopServer(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-dash': '1' }, body: '{}', signal: AbortSignal.timeout(2000),
    });
  } catch { /* already gone */ }
  // wait until it really stopped answering, so a window opened right afterwards starts a fresh server instead of finding this one dying
  for (let i = 0; i < 20 && await probe(port); i++) await new Promise((r) => setTimeout(r, 100));
}

// ---------------------------------------------------------------- running a window

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function lockFile(identity) { return join(identity, '.agents', 'state', 'dash-app.json'); }

/** Another window of this project, if one is open: `{ pid, port }` or null. */
export function openWindow(identity) {
  const l = readJson(lockFile(identity));
  return l && Number.isInteger(l.pid) && alive(l.pid) && l.pid !== process.pid ? l : null;
}

function waitFor(child) {
  return new Promise((done) => {
    const t0 = Date.now();
    child.once('error', (e) => done({ code: -1, ms: Date.now() - t0, error: e.message }));
    child.once('exit', (code) => done({ code, ms: Date.now() - t0 }));
  });
}

function openInBrowser(url) {
  for (const [cmd, ...args] of openCommands(url)) {
    const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true });
    if (r.status === 0) return true;
  }
  return false;
}

export function parseArgs(argv) {
  const o = { detach: false, noShell: false, browser: false, print: false, check: false, update: false, noUpdate: false, json: false, quiet: false, port: null, selftestOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--detach') o.detach = true;
    else if (a === '--no-shell') o.noShell = true;
    else if (a === '--browser') o.browser = true;
    else if (a === '--print') o.print = true;
    else if (a === '--check') o.check = true;
    else if (a === '--update') o.update = true;
    else if (a === '--no-update') o.noUpdate = true;
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--port') { o.port = Number(argv[++i]); if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port needs a number from 1 to 65535'); }
    else if (a === '--selftest-out') o.selftestOut = argv[++i] || null;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const identity = (() => { try { return realpathSync(usageRoot(root)); } catch { return usageRoot(root); } })();
  const port = opts.port || portFor(identity);
  const url = `http://127.0.0.1:${port}/`;
  const home = cacheHome();
  const target = targetOf();
  const say = opts.quiet ? () => {} : log;

  if (opts.check) {
    const cur = readCurrent(home);
    const check = readJson(join(home, 'check.json'));
    const out = { platform: `${process.platform}-${process.arch}`, target, cache: home, installed: cur && cur.version ? cur.version : null, problem: cur && cur.error ? cur.error : null, latestSeen: check && check.latest ? check.latest : null, lastCheck: check && check.checkedAt ? new Date(check.checkedAt).toISOString() : null };
    if (opts.json) console.log(JSON.stringify(out));
    else for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(10)} ${v === null ? '-' : v}`);
    return 0;
  }
  if (opts.update) {
    const r = await updateShell({ home, target, force: true });
    say(r.status === 'updated' ? `installed desktop shell ${r.version}` : r.status === 'current' ? `desktop shell ${r.version} is current` : r.status === 'failed' ? `update failed: ${r.error}` : `nothing to install (${r.status}${r.reason ? `: ${r.reason}` : ''})`);
    return r.status === 'failed' ? 1 : 0;
  }

  // A pid can be reused by an unrelated program after a crash, so the window only counts as open if its server answers too.
  const other = openWindow(identity);
  if (other && !opts.print && await probe(other.port)) { say(`AI Dash is already open for this project (pid ${other.pid}, port ${other.port}).`); return 0; }

  const server = await ensureServer(root, port);
  if (opts.print) { console.log(url); return 0; }
  if (opts.detach) {
    const args = [fileURLToPath(import.meta.url), ...argv.filter((a) => a !== '--detach')];
    spawn(process.execPath, args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return 0;
  }
  writeJsonAtomic(lockFile(identity), { pid: process.pid, port, since: new Date().toISOString() });
  const clearLock = () => { try { const l = readJson(lockFile(identity)); if (l && l.pid === process.pid) rmSync(lockFile(identity), { force: true }); } catch { /* best effort */ } };
  const title = `AI Dash - ${basename(identity)}`;

  // 1. the desktop shell
  const skipShell = opts.noShell || opts.browser || process.env.AI_DASH_NO_SHELL === '1' || !target;
  if (!skipShell) {
    const noUpdate = opts.noUpdate || process.env.AI_DASH_NO_UPDATE === '1';
    let cur = readCurrent(home);
    if (cur && cur.error) say(`${cur.error}; reinstalling.`);
    if ((!cur || cur.error) && !noUpdate) {
      say('downloading the desktop shell (a few MB, once per machine)...');
      const r = await updateShell({ home, target, force: true });
      if (r.status === 'failed') say(`could not install it (${r.error}); using the browser instead.`);
      cur = readCurrent(home);
    } else if (cur && !noUpdate && shouldCheck(home)) {
      spawn(process.execPath, [fileURLToPath(import.meta.url), '--update', '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); // next start uses it
    }
    const bad = readJson(join(home, 'shell-failed.json'));
    if (cur && cur.binary && !(bad && bad.version === cur.version)) {
      const args = ['--url', url, '--title', title, '--project', identity, '--data-dir', join(home, 'webview')];
      if (opts.selftestOut) args.push('--selftest-out', opts.selftestOut);
      const child = spawn(cur.binary, args, { stdio: 'ignore', windowsHide: false });
      const r = await waitFor(child);
      if (r.code === 0 || r.ms > 5000) { clearLock(); if (server.started) await stopServer(port); return 0; } // it ran; closing it ends the dash we started
      writeJsonAtomic(join(home, 'shell-failed.json'), { version: cur.version, code: r.code, at: new Date().toISOString() });
      say(`the desktop shell would not start (exit ${r.code}${r.error ? `, ${r.error}` : ''}); using the browser instead.`);
    }
  }

  // 2. Edge or Chrome app mode, 3. the default browser
  const browser = process.env.AI_DASH_NO_APPMODE === '1' ? null : findBrowser();
  if (browser) {
    const child = spawn(browser, browserArgs(url, join(home, 'browser-profile')), { stdio: 'ignore', windowsHide: false });
    const r = await waitFor(child);
    clearLock();
    if (r.code === 0 || r.code === null) return 0;
    say(`the browser would not open an app window (exit ${r.code}); opening a tab.`);
  }
  clearLock();
  if (!openInBrowser(url)) { say(`open ${url} in your browser.`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`ai-dash-app: ${e.message}`); process.exit(1); });
}
