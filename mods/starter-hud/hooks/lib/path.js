// Pure helpers — no `$`, no Node builtins (a hooks module may only import its
// own relative files and "claude-code" — see `claude plugin validate`).
// Minimal POSIX-style join/dirname, enough for the plain paths this mod uses.

export function join(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p) => String(p))
    .join('/')
    .replace(/\/{2,}/g, '/');
}

export function dirname(path) {
  const s = String(path).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return s.slice(0, i);
}
