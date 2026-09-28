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
