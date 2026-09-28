import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
  mkdirSync, cpSync, rmSync, chmodSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, sep } from 'node:path';

/** List every file under `dir` (relative, posix-separated), skipping .git. */
export function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else {
      out.push(relative(base, full).split(sep).join('/'));
    }
  }
  return out;
}

export function hashFile(path) {
  return 'sha256:' + createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Best-effort chmod +x — silently skipped where it doesn't apply (Windows). */
export function makeExecutable(path) {
  try { chmodSync(path, 0o755); } catch { /* not fatal */ }
}

export function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

export { existsSync, mkdirSync, rmSync };
