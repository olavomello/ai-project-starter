// Tests for walk() and for `update` on a project that has links or a
// node_modules tree (regression: EISDIR on a Windows junction). Node's
// built-in test runner.
//
// Run: node --test cli/test/update.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk } from '../src/lib/fsutil.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = join(ROOT, 'cli', 'bin.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'update-test-'));
const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

function tryLink(target, path) {
  try { symlinkSync(target, path, 'junction'); return true; } catch { return false; }
}

test('walk lists regular files only: no links, no node_modules, no .git', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.js'), 'a');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), 'i');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'h');
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'f.txt'), 'f');
    const linked = tryLink(join(dir, 'real'), join(dir, 'link'));
    const files = walk(dir).sort();
    assert.deepEqual(files, ['real/f.txt', 'src/a.js']);
    if (!linked) console.log('# (could not create a link on this system; the link case was not exercised)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update works on a project containing a directory link and a node_modules tree', () => {
  const dir = tmp();
  const target = join(dir, 'proj');
  try {
    const init = cli('init', target, '--source', ROOT, '--no-prompt');
    assert.equal(init.status, 0, init.stderr);
    mkdirSync(join(target, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(target, 'node_modules', 'pkg', 'index.js'), 'x');
    mkdirSync(join(target, 'shared'));
    tryLink(join(target, 'shared'), join(target, 'shared-link'));
    const before = readFileSync(join(target, '.ai-project-starter.json'), 'utf8');
    const out = cli('update', target, '--source', ROOT, '--dry-run');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(join(target, '.ai-project-starter.json'), 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
