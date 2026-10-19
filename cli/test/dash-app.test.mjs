// Tests for the desktop launcher (scripts/ai-dash-app.mjs): ports, cache folders, release picking, the verified
// download and install, the update flow with a local release server, browser fallbacks and the CLI.
//
// Run: node --test cli/test/dash-app.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  portFor, cacheHome, targetOf, compareVersions, pickRelease, validateLatest, download, installShell, updateShell,
  readCurrent, shouldCheck, findBrowser, browserArgs, openCommands, parseArgs, probe, ensureServer, hashFile, openWindow, readToken,
  binaryName, CHECK_MS, RETRY_MS, MAX_BYTES,
} from '../../template/scripts/ai-dash-app.mjs';

const TEMPLATE = fileURLToPath(new URL('../../template', import.meta.url));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'dash-app-'));
const rm = (d) => rmSync(d, { recursive: true, force: true });
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// ---- a local stand-in for GitHub Releases ----
function releaseServer() {
  const state = { releases: [], files: new Map(), hits: [] };
  const server = http.createServer((req, res) => {
    state.hits.push(req.url);
    if (req.url === '/api/releases') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(state.releases(server.port))); }
    const file = state.files.get(req.url);
    if (!file) { res.statusCode = 404; return res.end('no'); }
    res.end(file);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.port = server.address().port;
    state.base = `http://127.0.0.1:${server.port}/dl/`;
    state.api = `http://127.0.0.1:${server.port}/api/releases`;
    state.close = () => new Promise((r) => server.close(r));
    // publish(version, bytes): adds a release with a latest.json for win-x64
    state.publish = (version, bytes, { lie = false } = {}) => {
      const name = 'ai-dash-desktop-win-x64.exe';
      const latest = { version, assets: { 'win-x64': { name, url: `${state.base}${version}/${name}`, sha256: lie ? 'a'.repeat(64) : sha(bytes), size: bytes.length } } };
      state.files.set(`/dl/${version}/${name}`, bytes);
      state.files.set(`/dl/${version}/latest.json`, JSON.stringify(latest));
      const list = state.list || (state.list = []);
      list.push({ tag_name: `desktop-v${version}`, draft: false, prerelease: false, assets: [{ name: 'latest.json', browser_download_url: `${state.base}${version}/latest.json` }] });
      state.releases = () => list;
    };
    state.releases = () => [];
    resolve(state);
  }));
}

// ---------------------------------------------------------------- pure helpers

test('portFor is stable, in range, ignores slashes and (on Windows) case, and spreads projects', () => {
  const a = portFor('D:/Work/Photic Books/project', 'win32');
  assert.ok(a >= 4300 && a <= 4899);
  assert.equal(a, portFor('d:\\work\\photic books\\project\\', 'win32'));
  assert.notEqual(portFor('/home/me/a', 'linux'), portFor('/home/me/A', 'linux'), 'case counts off Windows');
  const ports = new Set(Array.from({ length: 40 }, (_, i) => portFor(`/work/project-${i}`, 'linux')));
  assert.ok(ports.size > 25, `only ${ports.size} different ports for 40 projects`);
  assert.ok(![...ports].includes(4173), 'never the dash default port');
});

test('cacheHome picks a machine-wide folder per OS and honours AI_DASH_HOME', () => {
  assert.equal(cacheHome({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me'), join('C:\\Users\\me\\AppData\\Local', 'ai-project-starter', 'desktop'));
  assert.equal(cacheHome({}, 'darwin', '/Users/me'), join('/Users/me', 'Library', 'Application Support', 'ai-project-starter', 'desktop'));
  assert.equal(cacheHome({ XDG_DATA_HOME: '/x' }, 'linux', '/home/me'), join('/x', 'ai-project-starter', 'desktop'));
  assert.equal(cacheHome({}, 'linux', '/home/me'), join('/home/me', '.local', 'share', 'ai-project-starter', 'desktop'));
  assert.match(cacheHome({ AI_DASH_HOME: 'D:\\cache' }, 'win32', 'C:\\x'), /cache$/);
});

test('targetOf and binaryName: Windows x64 and macOS are offered, nothing else is', () => {
  assert.equal(targetOf('win32', 'x64'), 'win-x64');
  assert.equal(targetOf('darwin', 'arm64'), 'mac-arm64');
  assert.equal(targetOf('darwin', 'x64'), 'mac-x64');
  assert.equal(targetOf('win32', 'arm64'), null);
  assert.equal(targetOf('linux', 'x64'), null);
  assert.equal(binaryName('win32'), 'ai-dash-desktop.exe');
  assert.equal(binaryName('darwin'), 'ai-dash-desktop');
});

test('compareVersions compares numbers, not strings', () => {
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
});

test('pickRelease takes the highest published desktop release that has a latest.json', () => {
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: 'latest.json', browser_download_url: `https://x/${tag}/latest.json` }], ...extra });
  const picked = pickRelease([
    rel('desktop-v0.9.0'), rel('desktop-v0.10.0'), rel('desktop-v0.11.0', { draft: true }), rel('desktop-v0.12.0', { prerelease: true }),
    rel('v3.0.0'), rel('desktop-vbeta'), rel('desktop-v0.13.0', { assets: [] }),
  ]);
  assert.deepEqual(picked, { version: '0.10.0', tag: 'desktop-v0.10.0', latestUrl: 'https://x/desktop-v0.10.0/latest.json', latestApiUrl: null, assets: [] });
  const withApi = pickRelease([{ tag_name: 'desktop-v1.0.0', assets: [{ name: 'latest.json', browser_download_url: 'https://x/l', url: 'https://api/1' }, { name: 'a.exe', browser_download_url: 'https://x/a', url: 'https://api/2' }] }]);
  assert.deepEqual([withApi.latestApiUrl, withApi.assets], ['https://api/1', [{ name: 'latest.json', apiUrl: 'https://api/1' }, { name: 'a.exe', apiUrl: 'https://api/2' }]]);
  assert.equal(pickRelease([]), null);
  assert.equal(pickRelease(null), null);
});

test('validateLatest refuses anything that is not a plain, hashed, sized file under the allowed prefix', () => {
  const prefix = 'https://github.com/o/r/releases/download/';
  const good = { version: '0.1.0', assets: { 'win-x64': { name: 'ai-dash-desktop-win-x64.exe', url: `${prefix}desktop-v0.1.0/x.exe`, sha256: 'a'.repeat(64), size: 700000 } } };
  assert.equal(validateLatest(good, 'win-x64', prefix).size, 700000);
  const bad = (patch) => ({ version: '0.1.0', assets: { 'win-x64': { ...good.assets['win-x64'], ...patch } } });
  assert.throws(() => validateLatest(good, 'mac-arm64', prefix), /nothing for mac-arm64/);
  assert.throws(() => validateLatest(bad({ url: 'https://evil.test/x.exe' }), 'win-x64', prefix), /not under/);
  assert.throws(() => validateLatest(bad({ url: 'http://github.com/o/r/releases/download/x' }), 'win-x64', prefix), /not under/);
  assert.throws(() => validateLatest(bad({ sha256: 'xyz' }), 'win-x64', prefix), /sha256/);
  assert.throws(() => validateLatest(bad({ size: MAX_BYTES + 1 }), 'win-x64', prefix), /size/);
  assert.throws(() => validateLatest(bad({ size: 0 }), 'win-x64', prefix), /size/);
  assert.throws(() => validateLatest(bad({ name: '../x.exe' }), 'win-x64', prefix), /file name/);
  assert.throws(() => validateLatest({ ...good, version: 'latest' }, 'win-x64', prefix), /version/);
  assert.throws(() => validateLatest(null, 'win-x64', prefix), /object/);
});

test('findBrowser prefers Edge, then Chrome, per OS; browserArgs asks for an app window in its own profile', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\LA' };
  const edge = join('C:\\PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const chrome = join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe');
  assert.equal(findBrowser('win32', env, (p) => p === edge || p === chrome), edge);
  assert.equal(findBrowser('win32', env, (p) => p === chrome), chrome);
  assert.equal(findBrowser('win32', env, () => false), null);
  assert.equal(findBrowser('darwin', {}, (p) => p.includes('Google Chrome')), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findBrowser('linux', { PATH: '/usr/bin:/bin' }, (p) => p === join('/bin', 'chromium')), join('/bin', 'chromium'));
  const args = browserArgs('http://127.0.0.1:4412/', 'D:\\cache\\browser-profile');
  assert.ok(args.includes('--app=http://127.0.0.1:4412/') && args.includes('--user-data-dir=D:\\cache\\browser-profile'));
  assert.deepEqual(openCommands('http://x/')[1], ['open', 'http://x/']);
});

test('parseArgs reads the flags and refuses unknown ones and bad ports', () => {
  assert.deepEqual(parseArgs([]), { detach: false, noShell: false, browser: false, print: false, check: false, update: false, noUpdate: false, json: false, quiet: false, port: null, selftestOut: null });
  const o = parseArgs(['--detach', '--no-shell', '--port', '4555', '--selftest-out', 'x.json']);
  assert.deepEqual([o.detach, o.noShell, o.port, o.selftestOut], [true, true, 4555, 'x.json']);
  assert.throws(() => parseArgs(['--port', 'abc']), /--port/);
  assert.throws(() => parseArgs(['--port', '70000']), /--port/);
  assert.throws(() => parseArgs(['--open-file']), /unknown option/);
});

// ---------------------------------------------------------------- download, install, update

test('download refuses a wrong size or a wrong hash and leaves nothing behind', async () => {
  const dir = tmp(); const rel = await releaseServer();
  try {
    const bytes = Buffer.from('MZ-not-really-an-exe-but-bytes');
    rel.files.set('/dl/a.bin', bytes);
    const dest = join(dir, 'a.bin');
    await download(`${rel.base}a.bin`, dest, { size: bytes.length, sha256: sha(bytes) });
    assert.deepEqual(readFileSync(dest), bytes);
    const dest2 = join(dir, 'b.bin');
    await assert.rejects(download(`${rel.base}a.bin`, dest2, { size: bytes.length, sha256: 'b'.repeat(64) }), /SHA-256/);
    await assert.rejects(download(`${rel.base}a.bin`, dest2, { size: bytes.length - 1, sha256: sha(bytes) }), /larger/);
    await assert.rejects(download(`${rel.base}a.bin`, dest2, { size: bytes.length + 5, sha256: sha(bytes) }), /bytes/);
    await assert.rejects(download(`${rel.base}missing`, dest2, { size: 1, sha256: 'c'.repeat(64) }), /404/);
    assert.equal(existsSync(dest2), false);
  } finally { await rel.close(); rm(dir); }
});

test('updateShell installs, throttles, upgrades, keeps one previous version and prunes the rest', async () => {
  const home = tmp(); const rel = await releaseServer();
  const opts = (extra = {}) => ({ home, target: 'win-x64', platform: 'win32', api: rel.api, prefix: rel.base, ...extra });
  try {
    assert.deepEqual(await updateShell(opts({ force: true })), { status: 'no-release' }, 'no release yet');
    assert.equal(readCurrent(home), null);

    rel.publish('0.1.0', Buffer.from('binary-one'));
    const first = await updateShell(opts({ force: true }));
    assert.deepEqual(first, { status: 'updated', version: '0.1.0' });
    const cur = readCurrent(home);
    assert.equal(cur.version, '0.1.0');
    assert.equal(readFileSync(cur.binary, 'utf8'), 'binary-one');
    assert.match(cur.binary, /0\.1\.0[\\/]ai-dash-desktop\.exe$/);
    assert.equal(JSON.parse(readFileSync(join(home, 'current.json'), 'utf8')).sha256, sha(Buffer.from('binary-one')));

    const hitsBefore = rel.hits.length;
    assert.equal((await updateShell(opts())).status, 'skipped', 'throttled for a day');
    assert.equal(rel.hits.length, hitsBefore, 'a throttled check does not touch the network');
    assert.equal(shouldCheck(home, Date.now() + CHECK_MS + 1000), true);
    assert.equal((await updateShell(opts({ force: true }))).status, 'current');

    rel.publish('0.2.0', Buffer.from('binary-two'));
    assert.deepEqual(await updateShell(opts({ force: true })), { status: 'updated', version: '0.2.0' });
    assert.equal(readFileSync(readCurrent(home).binary, 'utf8'), 'binary-two');
    assert.equal(JSON.parse(readFileSync(join(home, 'current.json'), 'utf8')).previous, '0.1.0');
    assert.deepEqual(readdirSync(home).filter((n) => /^\d/.test(n)).sort(), ['0.1.0', '0.2.0']);

    rel.publish('0.10.0', Buffer.from('binary-ten'));
    await updateShell(opts({ force: true }));
    assert.deepEqual(readdirSync(home).filter((n) => /^\d/.test(n)).sort(), ['0.10.0', '0.2.0'], '0.1.0 is pruned; 0.10.0 sorts after 0.2.0 by number');
    assert.equal(readCurrent(home).version, '0.10.0');
    assert.equal(readdirSync(home).some((n) => n.startsWith('.tmp-')), false, 'no scratch folders left');
  } finally { await rel.close(); rm(home); }
});

test('a tampered or lying release never replaces a working install, and a failure retries in an hour', async () => {
  const home = tmp(); const rel = await releaseServer();
  const opts = (extra = {}) => ({ home, target: 'win-x64', platform: 'win32', api: rel.api, prefix: rel.base, ...extra });
  try {
    rel.publish('0.1.0', Buffer.from('good'));
    await updateShell(opts({ force: true }));
    rel.publish('0.2.0', Buffer.from('evil'), { lie: true }); // latest.json promises a hash the file does not have
    const r = await updateShell(opts({ force: true, now: 1_000_000 }));
    assert.equal(r.status, 'failed');
    assert.match(r.error, /SHA-256/);
    assert.equal(readFileSync(readCurrent(home).binary, 'utf8'), 'good', 'the working install is untouched');
    assert.equal(existsSync(join(home, '0.2.0')), false);
    assert.equal(JSON.parse(readFileSync(join(home, 'check.json'), 'utf8')).nextCheck, 1_000_000 + RETRY_MS);
  } finally { await rel.close(); rm(home); }
});

test('a private repository: public access is refused, then the signed-in token opens the API and the asset URLs', async () => {
  const home = tmp();
  const TOKEN = `ghp_${'x'.repeat(24)}`;
  const name = 'ai-dash-desktop-win-x64.exe';
  const bytes = Buffer.from('private-binary');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization, accept: req.headers.accept });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 404; return res.end('Not Found'); }
    const o = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/api/releases') {
      return res.end(JSON.stringify([{ tag_name: 'desktop-v0.1.0', draft: false, prerelease: false, assets: [
        { name: 'latest.json', browser_download_url: `${o}/dl/latest.json`, url: `${o}/api/assets/1` },
        { name, browser_download_url: `${o}/dl/${name}`, url: `${o}/api/assets/2` }] }]));
    }
    if (req.url === '/api/assets/1') return res.end(JSON.stringify({ version: '0.1.0', assets: { 'win-x64': { name, url: `${o}/dl/${name}`, sha256: sha(bytes), size: bytes.length } } }));
    if (req.url === '/api/assets/2') return res.end(bytes);
    res.statusCode = 404; res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${server.address().port}`;
  const opts = { home, target: 'win-x64', platform: 'win32', force: true, api: `${o}/api/releases`, prefix: `${o}/dl/` };
  try {
    const none = await updateShell({ ...opts, token: () => null });
    assert.equal(none.status, 'failed');
    assert.match(none.error, /private.*GH_TOKEN/);
    assert.equal(seen.at(-1).auth, undefined, 'without a token nothing is sent');

    seen.length = 0;
    assert.deepEqual(await updateShell({ ...opts, token: () => TOKEN }), { status: 'updated', version: '0.1.0' });
    assert.equal(readFileSync(readCurrent(home).binary, 'utf8'), 'private-binary');
    assert.equal(seen[0].auth, undefined, 'the first try is public');
    assert.ok(seen.slice(1).every((s) => s.auth === `Bearer ${TOKEN}`));
    assert.equal(seen.find((s) => s.url === '/api/assets/2').accept, 'application/octet-stream');
  } finally { server.close(); rm(home); }
});

test('readToken prefers GH_TOKEN, then GITHUB_TOKEN, then the gh CLI, and ignores nonsense', () => {
  const never = () => { throw new Error('gh must not be asked'); };
  assert.equal(readToken({ GH_TOKEN: ' abc ', GITHUB_TOKEN: 'zzz' }, never), 'abc');
  assert.equal(readToken({ GITHUB_TOKEN: 'zzz' }, never), 'zzz');
  const gh = (out, status = 0) => () => ({ status, stdout: out });
  assert.equal(readToken({}, gh(`gho_${'a'.repeat(30)}
`)), 'gho_' + 'a'.repeat(30));
  assert.equal(readToken({}, gh('error: not logged in', 1)), null);
  assert.equal(readToken({}, gh('has spaces and is not a token')), null);
  assert.equal(readToken({}, () => { throw new Error('gh is not installed'); }), null);
});

test('a release outside the allowed download prefix is refused before anything is fetched from it', async () => {
  const home = tmp(); const rel = await releaseServer();
  try {
    rel.publish('0.1.0', Buffer.from('x'));
    const r = await updateShell({ home, target: 'win-x64', platform: 'win32', force: true, api: rel.api, prefix: 'https://github.com/o/r/releases/download/' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /not under/);
    assert.equal(readCurrent(home), null);
    assert.ok(!rel.hits.some((h) => h.endsWith('.exe')), 'the binary was never requested');
  } finally { await rel.close(); rm(home); }
});

test('readCurrent notices a binary that was changed or removed after install', async () => {
  const home = tmp(); const rel = await releaseServer();
  try {
    rel.publish('0.1.0', Buffer.from('original'));
    await updateShell({ home, target: 'win-x64', platform: 'win32', force: true, api: rel.api, prefix: rel.base });
    const { binary } = readCurrent(home);
    writeFileSync(binary, 'patched');
    assert.match(readCurrent(home).error, /changed/);
    rmSync(binary);
    assert.match(readCurrent(home).error, /missing/);
    // an install over the damaged one repairs it
    const r = await updateShell({ home, target: 'win-x64', platform: 'win32', force: true, api: rel.api, prefix: rel.base });
    assert.deepEqual(r, { status: 'updated', version: '0.1.0' });
    assert.equal(readFileSync(readCurrent(home).binary, 'utf8'), 'original');
    writeFileSync(join(home, 'current.json'), JSON.stringify({ version: '0.1.0', binary: '../../outside.exe', sha256: 'a'.repeat(64) }));
    assert.match(readCurrent(home).error, /outside/);
  } finally { await rel.close(); rm(home); }
});

test('the macOS archive path unpacks the binary and makes it executable (prepared, not run on a Mac)', async (t) => {
  if (spawnSync('tar', ['--version'], { stdio: 'ignore' }).status !== 0) return t.skip('no tar here');
  const home = tmp(); const work = tmp(); const rel = await releaseServer();
  try {
    writeFileSync(join(work, 'ai-dash-desktop'), 'mach-o-bytes');
    execFileSync('tar', ['-czf', 'a.tar.gz', 'ai-dash-desktop'], { cwd: work });
    const bytes = readFileSync(join(work, 'a.tar.gz'));
    rel.files.set('/dl/0.1.0/ai-dash-desktop-mac-arm64.tar.gz', bytes);
    const entry = { version: '0.1.0', name: 'ai-dash-desktop-mac-arm64.tar.gz', url: `${rel.base}0.1.0/ai-dash-desktop-mac-arm64.tar.gz`, sha256: sha(bytes), size: bytes.length };
    const done = await installShell({ entry, home, platform: 'darwin' });
    assert.match(done.binary, /0\.1\.0[\\/]ai-dash-desktop$/);
    assert.equal(readFileSync(done.binary, 'utf8'), 'mach-o-bytes');
    if (process.platform !== 'win32') assert.ok((statSync(done.binary).mode & 0o111) !== 0, 'executable bit set');
    assert.equal(hashFile(done.binary), sha(Buffer.from('mach-o-bytes')));
  } finally { await rel.close(); rm(home); rm(work); }
});

// ---------------------------------------------------------------- the server and the CLI

test('openWindow sees a live window of the project and ignores a stale or its own lock', () => {
  const dir = tmp();
  try {
    const lock = join(dir, '.agents', 'state', 'dash-app.json');
    mkdirSync(join(dir, '.agents', 'state'), { recursive: true });
    assert.equal(openWindow(dir), null, 'no lock');
    writeFileSync(lock, JSON.stringify({ pid: process.pid, port: 4400 }));
    assert.equal(openWindow(dir), null, 'the lock of this very process is not "another window"');
    const parent = process.ppid;
    writeFileSync(lock, JSON.stringify({ pid: parent, port: 4401 }));
    assert.deepEqual(openWindow(dir), { pid: parent, port: 4401 });
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 31 - 2, port: 4402 }));
    assert.equal(openWindow(dir), null, 'a pid nobody has');
    writeFileSync(lock, '{ nope');
    assert.equal(openWindow(dir), null, 'a damaged lock');
  } finally { rm(dir); }
});

test('probe tells AI Dash from any other program on a port', async () => {
  const dash = http.createServer((req, res) => res.end(JSON.stringify({ mod: { enabled: false } })));
  const other = http.createServer((req, res) => res.end(JSON.stringify({ hello: 'world' })));
  await Promise.all([dash, other].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  try {
    assert.equal(await probe(dash.address().port), true);
    assert.equal(await probe(other.address().port), false);
    assert.equal(await probe(await freePort()), false);
  } finally { dash.close(); other.close(); }
});

function projectCopy() {
  const dir = tmp();
  cpSync(join(TEMPLATE, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(TEMPLATE, 'ai-dash'), join(dir, 'ai-dash'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  return dir;
}
async function shutdown(port) {
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-dash': '1' }, body: '{}' }).catch(() => {});
}

test('ensureServer starts the project dash once and reuses it afterwards', async () => {
  const dir = projectCopy(); const port = await freePort();
  try {
    assert.deepEqual(await ensureServer(dir, port), { started: true });
    assert.equal(await probe(port), true);
    assert.deepEqual(await ensureServer(dir, port), { started: false });
  } finally { await shutdown(port); await new Promise((r) => setTimeout(r, 300)); rm(dir); }
});

test('the CLI: --print starts the dash on the project port and prints its URL; --check --json reports the cache', async () => {
  const dir = projectCopy(); const home = tmp();
  const env = { ...process.env, AI_DASH_HOME: home, AI_DASH_NO_UPDATE: '1' };
  const run = (...args) => spawnSync(process.execPath, [join(dir, 'scripts', 'ai-dash-app.mjs'), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 30000 });
  let port;
  try {
    const printed = run('--print');
    assert.equal(printed.status, 0, printed.stderr);
    const m = printed.stdout.trim().match(/^http:\/\/127\.0\.0\.1:(\d+)\/$/);
    assert.ok(m, printed.stdout);
    port = Number(m[1]);
    assert.ok(port >= 4300 && port <= 4899);
    assert.equal(await probe(port), true);
    assert.equal(run('--print').stdout.trim(), `http://127.0.0.1:${port}/`, 'same project, same port');

    const check = JSON.parse(run('--check', '--json').stdout);
    assert.equal(check.installed, null);
    assert.equal(check.cache, home);
    assert.equal(check.target, targetOf());

    const bad = run('--bogus');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown option/);
  } finally { if (port) await shutdown(port); await new Promise((r) => setTimeout(r, 300)); rm(dir); rm(home); }
});
