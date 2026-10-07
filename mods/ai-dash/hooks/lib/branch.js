// Pure helpers — no `$`. Branch-name handling shared between the mod and the
// log pipeline. Must produce byte-identical output to the sanitizing rule in
// template/scripts/gate.sh (see the comment there) so a usage file written
// under one name is always found by ai-log.mjs under the same name.

/** Same transform as `printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '_'`. */
export function sanitizeBranch(branch) {
  return String(branch).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** "agent/dev-api-tester" -> "dev-api-tester"; anything else -> "main". */
export function agentNameFromBranch(branch) {
  const m = /^agent\/(.+)$/.exec(String(branch || ''));
  return m ? m[1] : 'main';
}
