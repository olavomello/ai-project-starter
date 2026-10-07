import { createHash } from 'node:crypto';
// Thin wrapper around `git`. The CLI shells out to the real `git` binary
// (present on Windows without WSL/Git Bash — only the *.sh scripts needed
// bash) rather than reimplementing clone/rev-parse.
import { spawnSync } from 'node:child_process';

export function gitAvailable() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

export function gitCloneShallow(url, ref, dest) {
  const r = spawnSync(
    'git',
    ['clone', '--quiet', '--depth', '1', '--branch', ref, url, dest],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(
      `git clone of ${url}#${ref} failed:\n${(r.stderr || r.stdout || '').trim()}`,
    );
  }
}

/**
 * sha256 of every version `path` has had in the repo at `dir` (newest first, at most `cap`), or null when
 * the history cannot be read. A shallow clone has no history, so the first call fetches it.
 */
export function gitHistoryHashes(dir, path, cap = 40) {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: dir, encoding: 'utf8' });
  if (shallow.status === 0 && shallow.stdout.trim() === 'true') {
    spawnSync('git', ['fetch', '--quiet', '--unshallow', 'origin'], { cwd: dir, encoding: 'utf8' });
  }
  const log = spawnSync('git', ['log', '--format=%H', `-${cap}`, '--', path], { cwd: dir, encoding: 'utf8' });
  if (log.status !== 0) return null;
  const hashes = new Set();
  for (const sha of log.stdout.split(/\r?\n/).filter(Boolean)) {
    const r = spawnSync('git', ['show', `${sha}:${path}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0) hashes.add(`sha256:${createHash('sha256').update(r.stdout).digest('hex')}`);
  }
  return hashes;
}

export function gitRevParseHead(dir) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

export function gitInit(dir) {
  run(dir, ['init', '--quiet']);
  const branch = spawnSync('git', ['branch', '-M', 'main'], { cwd: dir, encoding: 'utf8' });
  void branch; // best-effort; older git defaults to master, that's fine too
}

export function gitAddAll(dir) {
  run(dir, ['add', '-A']);
}

export function gitCommit(dir, message) {
  run(dir, ['-c', 'user.email=ai-project-starter@local', '-c', 'user.name=ai-project-starter', 'commit', '--quiet', '-m', message]);
}

function run(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return r.stdout;
}
