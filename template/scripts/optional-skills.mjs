#!/usr/bin/env node
// Turns the starter's optional skills on or off for a project. The skills ship inert in
// docs/optional-skills/<name>/ (Claude Code does not load them from there); enabling one copies it
// to .claude/skills/<name>/, which is where Claude Code, `scripts/skills.mjs check` and AI Dash look.
// Used by `ai-project-starter init` (the setup question), by the bootstrap prompt, and by hand.
//
// Usage:
//   node scripts/optional-skills.mjs list|status [--dir <path>] [--json]
//   node scripts/optional-skills.mjs enable  <name> [--dir <path>]
//   node scripts/optional-skills.mjs disable <name> [--dir <path>]
//
// `disable` removes .claude/skills/<name>/ only when it is still identical to the shipped copy, so a
// skill the project has edited is never deleted from under it. Zero dependencies.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const sourceDir = (dir) => join(dir, 'docs', 'optional-skills');
const targetDir = (dir) => join(dir, '.claude', 'skills');

function files(root, rel = '') {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...files(root, r));
    else out.push(r);
  }
  return out.sort();
}

function sameTree(a, b) {
  const fa = files(a);
  const fb = files(b);
  if (fa.join('\n') !== fb.join('\n')) return false;
  return fa.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

/** First line of a skill's description, for listings. */
function describe(skillMd) {
  try {
    const m = readFileSync(skillMd, 'utf8').match(/^description:\s*(.+)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/** Every optional skill the starter ships, and whether this project has it switched on. */
export function listOptional(dir = '.') {
  const src = sourceDir(dir);
  if (!existsSync(src)) return [];
  return readdirSync(src, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(src, e.name, 'SKILL.md')))
    .map((e) => ({
      name: e.name,
      enabled: existsSync(join(targetDir(dir), e.name, 'SKILL.md')),
      description: describe(join(src, e.name, 'SKILL.md')),
    }));
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const f of files(from)) {
    const dest = join(to, f);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, readFileSync(join(from, f)));
  }
}

function assertName(dir, name) {
  if (!name || !NAME_RE.test(name) || !existsSync(join(sourceDir(dir), name, 'SKILL.md'))) {
    const known = listOptional(dir).map((s) => s.name).join(', ') || 'none shipped';
    throw new Error(`unknown optional skill "${name ?? ''}" (available: ${known})`);
  }
}

/** Copies the skill into .claude/skills/. Idempotent; never overwrites a copy the project has edited. */
export function enableSkill(dir, name) {
  assertName(dir, name);
  const from = join(sourceDir(dir), name);
  const to = join(targetDir(dir), name);
  if (existsSync(to)) return { name, changed: false, note: sameTree(from, to) ? 'already enabled' : 'already enabled (project copy has local edits, left as is)' };
  copyTree(from, to);
  return { name, changed: true, note: 'enabled' };
}

/** Removes .claude/skills/<name>/ unless the project has edited it. */
export function disableSkill(dir, name) {
  assertName(dir, name);
  const from = join(sourceDir(dir), name);
  const to = join(targetDir(dir), name);
  if (!existsSync(to)) return { name, changed: false, note: 'already disabled' };
  if (!statSync(to).isDirectory() || !sameTree(from, to)) {
    return { name, changed: false, note: `kept: ${to} has local edits; delete it by hand if you want it gone` };
  }
  rmSync(to, { recursive: true, force: true });
  return { name, changed: true, note: 'disabled' };
}

// ---- CLI entrypoint (skipped when imported) ----
function die(msg) { console.error(`optional-skills: ${msg}`); process.exit(1); }

function main(argv) {
  const [sub, ...rest] = argv;
  let dir = '.';
  let json = false;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--dir') dir = rest[++i] ?? die('--dir needs a value');
    else if (rest[i] === '--json') json = true;
    else if (rest[i].startsWith('--')) die(`unknown argument: ${rest[i]}`);
    else positional.push(rest[i]);
  }
  try {
    if (sub === 'list' || sub === 'status') {
      const skills = listOptional(dir);
      if (json) console.log(JSON.stringify({ skills }, null, 2));
      else if (!skills.length) console.log('no optional skills shipped');
      else for (const s of skills) console.log(`${s.name}: ${s.enabled ? 'enabled' : 'disabled'}`);
    } else if (sub === 'enable' || sub === 'disable') {
      const r = (sub === 'enable' ? enableSkill : disableSkill)(dir, positional[0]);
      console.log(`${r.name}: ${r.note}`);
    } else {
      die('usage: optional-skills.mjs <list|status|enable|disable> [<name>] [--dir <path>] [--json]');
    }
  } catch (e) {
    die(e.message);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
