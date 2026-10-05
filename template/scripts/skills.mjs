#!/usr/bin/env node
// Lists and validates the project's skills (.claude/skills/<name>/SKILL.md).
// Single source of truth for "is this skill's YAML frontmatter correct and
// complete": the gate (`check`), the ai-dash skills viewer (via
// scripts/ai-dash.mjs's GET /api/skills) and `cli doctor` all use it.
//
// Usage:
//   node scripts/skills.mjs list  [--dir <project>] [--json]
//   node scripts/skills.mjs check [--dir <project>] [--json] [--strict]
//
// `check` exits 1 when any skill has an error. Warnings never fail it unless
// --strict is given. Zero dependencies: the frontmatter is parsed by a small
// purpose-built reader, not a YAML library — it only understands what a
// skill header needs (top-level `key: value`, quoted strings, `>`/`|` block
// scalars, and nested blocks it keeps raw), and it refuses, rather than
// guesses at, anything else.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESC_MAX = 1024;
const DESC_MIN_USEFUL = 40; // shorter than this is almost never enough to say what AND when
const TRIGGER_HINT = /\b(use|when|whenever|trigger|if)\b/i;

/**
 * Parses the `---` frontmatter block at the top of a SKILL.md.
 * Returns { data, errors } where data maps top-level keys to string values
 * (nested maps/lists are kept as their raw text) and errors lists anything
 * that would make a real YAML parser reject or misread the header.
 */
export function parseFrontmatter(text) {
  const errors = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { data: {}, errors: ['no frontmatter: the file must start with a "---" line'] };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) {
    return { data: {}, errors: ['frontmatter is never closed (missing the second "---" line)'] };
  }

  const data = {};
  const body = lines.slice(1, end);
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\t/.test(line) || /^ +\t/.test(line)) { errors.push(`line ${i + 2}: tabs are not allowed for indentation`); continue; }
    if (/^\s/.test(line)) { errors.push(`line ${i + 2}: unexpected indentation (not part of a block value)`); continue; }

    const m = /^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) { errors.push(`line ${i + 2}: not a "key: value" pair`); continue; }
    const key = m[1];
    let value = (m[2] ?? '').trim();
    if (key in data) errors.push(`line ${i + 2}: duplicate key "${key}"`);

    // Gather the indented continuation lines that belong to this key.
    const cont = [];
    while (i + 1 < body.length && (/^\s+\S/.test(body[i + 1]) || body[i + 1].trim() === '')) {
      cont.push(body[++i]);
    }
    while (cont.length && cont[cont.length - 1].trim() === '') cont.pop();

    if (/^[>|][+-]?\d*$/.test(value)) {
      // Block scalar: folded (>) joins lines with spaces, literal (|) keeps newlines.
      const folded = value[0] === '>';
      const parts = cont.map((l) => l.trim());
      data[key] = folded ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n').trim();
      continue;
    }
    if (value === '' && cont.length) { data[key] = cont.map((l) => l.trim()).join('\n'); continue; } // nested map/list, kept raw
    if (cont.length) {
      // A plain scalar may continue on following indented lines in real YAML,
      // but a skill description that does this is almost always a mistake.
      value = [value, ...cont.map((l) => l.trim())].join(' ');
    }

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || value[value.length - 1] !== quote) {
        errors.push(`"${key}": the ${quote === '"' ? 'double' : 'single'}-quoted string is never closed`);
      } else {
        const inner = value.slice(1, -1);
        data[key] = quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'");
        continue;
      }
    } else if (value) {
      // Plain scalar pitfalls that make YAML reject or silently reinterpret the line.
      if (/: |:$/.test(value)) errors.push(`"${key}": an unquoted value contains ": " — YAML reads that as a nested mapping. Quote the value or use a block scalar (">")`);
      if (/\s#/.test(value)) errors.push(`"${key}": an unquoted value contains " #" — YAML treats the rest as a comment and drops it. Quote the value`);
      if (/^[[{*&!%@`|>]/.test(value)) errors.push(`"${key}": an unquoted value starting with "${value[0]}" is parsed as YAML syntax, not text. Quote the value`);
    }
    data[key] = value;
  }
  return { data, errors };
}

/** Checks one parsed skill and returns { errors, warnings }. */
export function validateSkill(dirName, fm) {
  const errors = [...fm.errors];
  const warnings = [];
  const { name, description } = fm.data;

  if (name === undefined || name === '') errors.push('missing required field: name');
  else {
    if (!NAME_RE.test(name)) errors.push(`name "${name}" must be lowercase letters, digits and single hyphens`);
    if (name.length > NAME_MAX) errors.push(`name is ${name.length} characters (max ${NAME_MAX})`);
    if (name !== dirName) errors.push(`name "${name}" must match its folder name "${dirName}"`);
  }

  if (description === undefined || description === '') errors.push('missing required field: description');
  else {
    if (description.length > DESC_MAX) errors.push(`description is ${description.length} characters (max ${DESC_MAX})`);
    if (description.length < DESC_MIN_USEFUL) warnings.push(`description is very short (${description.length} characters) — say what the skill does and when to use it`);
    else if (!TRIGGER_HINT.test(description)) warnings.push('description never says when to use the skill ("Use when…") — that is what makes it trigger');
    if (/[<>]/.test(description)) warnings.push('description contains "<" or ">" — some tools reject angle brackets in skill descriptions');
  }
  return { errors, warnings };
}

/** Reads every skill under <dir>/.claude/skills. A skill is a folder; one without SKILL.md is reported, not skipped. */
export function listSkills(dir = '.') {
  const root = join(dir, '.claude', 'skills');
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root).sort()) {
    const folder = join(root, entry);
    if (!statSync(folder).isDirectory()) continue;
    const file = join(folder, 'SKILL.md');
    if (!existsSync(file)) {
      out.push({ dir: entry, name: entry, description: '', errors: ['missing SKILL.md'], warnings: [] });
      continue;
    }
    const fm = parseFrontmatter(readFileSync(file, 'utf8'));
    const { errors, warnings } = validateSkill(entry, fm);
    out.push({
      dir: entry,
      name: fm.data.name || entry,
      description: fm.data.description || '',
      errors,
      warnings,
    });
  }
  return out;
}

// ---- CLI entrypoint (skipped when imported, e.g. by ai-dash.mjs) ----
function die(msg) { console.error(`skills: ${msg}`); process.exit(1); }

function parseFlags(argv) {
  const flags = { dir: '.' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { flags.json = true; continue; }
    if (a === '--strict') { flags.strict = true; continue; }
    if (a === '--dir') { flags.dir = argv[++i]; continue; }
    die(`unknown argument: ${a}`);
  }
  return flags;
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);
  if (cmd !== 'list' && cmd !== 'check') {
    console.log('Usage: node scripts/skills.mjs list|check [--dir <project>] [--json] [--strict]');
    process.exit(cmd ? 1 : 0);
  }
  const skills = listSkills(flags.dir);
  const bad = skills.filter((s) => s.errors.length || (flags.strict && s.warnings.length));

  if (flags.json) {
    console.log(JSON.stringify({ skills }, null, 2));
  } else if (cmd === 'list') {
    if (!skills.length) console.log('No skills in .claude/skills/.');
    for (const s of skills) {
      console.log(`${s.name}${s.errors.length ? '  [invalid]' : ''}`);
      if (s.description) console.log(`  ${s.description}`);
    }
  } else {
    for (const s of skills) {
      for (const e of s.errors) console.error(`FAIL: .claude/skills/${s.dir}/SKILL.md: ${e}`);
      for (const w of s.warnings) console.error(`warn: .claude/skills/${s.dir}/SKILL.md: ${w}`);
    }
    if (!bad.length) console.log(`ok:   ${skills.length} skill${skills.length === 1 ? '' : 's'}, frontmatter valid`);
  }
  if (cmd === 'check' && bad.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
