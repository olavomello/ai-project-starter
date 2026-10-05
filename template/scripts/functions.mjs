#!/usr/bin/env node
// Catalog of "Functions": prompts or algorithms an agent noticed it reuses,
// written once as docs/functions/<camelCaseName>.md and called by name.
//
//   node scripts/functions.mjs new <name> --params "a : Type, b : Type" --desc "<what it does>" [--prompt "<body>"] [--by <who>]
//   node scripts/functions.mjs list  [--dir <project>] [--json]
//   node scripts/functions.mjs check [--dir <project>] [--json]
//   node scripts/functions.mjs use <name>     record a use (feeds "last usage" in `list` and ai-dash)
//   node scripts/functions.mjs index          rewrite docs/functions/README.md
//
// File format (inside a code fence, one function per file):
//   function dateFormat( dte : Date ) {
//     ---
//     <description>
//     Creation date : YYYY-MM-DD HH:MM:SS
//     Created by : <who>
//     Last usage : 0000-00-00 00:00:00     <- written zeroed; real value comes from the usage log
//     ---
//     <prompt, using the params, saying what it returns>
//   }
// "Last usage" is NOT rewritten in the file on each use: that would put a
// commit (and a merge conflict between worktrees) behind every call. `use`
// appends to the local usage log instead (see scripts/skills.mjs).
// Zero dependencies.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATE_RE, NEVER, stamp, recordUse, usageMap } from './skills.mjs';

const NAME_RE = /^[a-z][A-Za-z0-9]*$/;
const PARAM_RE = /^[A-Za-z_]\w*\s*:\s*\S.*$/;
const HEAD_RE = /^function\s+([A-Za-z_]\w*)\(\s*(.*?)\s*\)\s*\{\s*$/;
const fnDir = (dir) => join(dir, 'docs', 'functions');

/** Parses one function file. Returns { fn, errors }; fn is null when the header can't be read. */
export function parseFunction(text) {
  const errors = [];
  const lines = String(text).split(/\r?\n/).filter((l) => !/^\s*```/.test(l));
  const hi = lines.findIndex((l) => l.trim() !== '');
  const head = hi === -1 ? null : HEAD_RE.exec(lines[hi].trim());
  if (!head) return { fn: null, errors: ['first line must be: function nameInCamelCase( param : Type ) {'] };
  const [, name, rawParams] = head;
  const params = rawParams ? rawParams.split(',').map((p) => p.trim()) : [];
  for (const p of params) if (!PARAM_RE.test(p)) errors.push(`parameter "${p}" must look like "name : Type"`);

  const rest = lines.slice(hi + 1).map((l) => l.trim());
  while (rest.length && rest[rest.length - 1] === '') rest.pop();
  if (rest[rest.length - 1] !== '}') errors.push('function must end with a closing "}" line');
  else rest.pop();
  const a = rest.indexOf('---');
  const b = a === -1 ? -1 : rest.indexOf('---', a + 1);
  if (a !== 0 || b === -1) {
    errors.push('missing the "---" metadata block right after the header');
    return { fn: { name, params, description: '', creationDate: '', createdBy: '', lastUsage: '', body: '' }, errors };
  }
  const meta = rest.slice(1, b);
  const body = rest.slice(b + 1).join('\n').trim();
  const field = (label) => {
    const l = meta.find((m) => m.toLowerCase().startsWith(label.toLowerCase() + ' :') || m.toLowerCase().startsWith(label.toLowerCase() + ':'));
    return l === undefined ? undefined : l.slice(l.indexOf(':') + 1).trim();
  };
  const description = meta.filter((m) => !/^(creation date|created by|last usage)\s*:/i.test(m)).join(' ').trim();
  const fn = { name, params, description, creationDate: field('Creation date'), createdBy: field('Created by'), lastUsage: field('Last usage'), body };
  if (!description) errors.push('missing description');
  if (fn.creationDate === undefined || !DATE_RE.test(fn.creationDate)) errors.push('"Creation date" must be YYYY-MM-DD HH:MM:SS');
  if (!fn.createdBy) errors.push('missing "Created by"');
  if (fn.lastUsage === undefined || !(DATE_RE.test(fn.lastUsage) || fn.lastUsage === NEVER)) errors.push('"Last usage" must be YYYY-MM-DD HH:MM:SS (0000-00-00 00:00:00 until first use)');
  if (!body) errors.push('missing the function body (the prompt)');
  return { fn, errors };
}

export function listFunctions(dir = '.') {
  const root = fnDir(dir);
  if (!existsSync(root)) return [];
  const used = usageMap(dir);
  const out = [];
  for (const f of readdirSync(root).filter((x) => x.endsWith('.md') && x !== 'README.md').sort()) {
    const base = f.slice(0, -3);
    const { fn, errors } = parseFunction(readFileSync(join(root, f), 'utf8'));
    if (fn && !NAME_RE.test(fn.name)) errors.push(`name "${fn.name}" must be camelCase (start lowercase, letters and digits only)`);
    if (fn && fn.name !== base) errors.push(`name "${fn.name}" must match its file name "${base}.md"`);
    out.push({
      file: f, name: fn?.name || base, params: fn?.params || [], description: fn?.description || '',
      creationDate: fn?.creationDate || '', createdBy: fn?.createdBy || '',
      lastUsage: used.get(`function:${fn?.name || base}`) || NEVER, errors, warnings: [],
    });
  }
  return out;
}

export function renderFunction({ name, params, description, createdBy, prompt }) {
  return '```\n' + `function ${name}( ${params.join(', ')} ) {\n  ---\n  ${description}\n  Creation date : ${stamp()}\n  Created by : ${createdBy}\n  Last usage : ${NEVER}\n  ---\n  ${prompt}\n}\n` + '```\n';
}

export function createFunction(dir, { name, params = [], description, prompt, by = 'admin' }) {
  const file = join(fnDir(dir), `${name}.md`);
  if (existsSync(file)) throw new Error(`function "${name}" already exists`);
  if (!NAME_RE.test(name || '')) throw new Error('name must be camelCase');
  if (!description) throw new Error('--desc is required');
  const text = renderFunction({ name, params, description, createdBy: by, prompt: prompt || 'TODO: the prompt, using the parameters, saying what is returned.' });
  const { errors } = parseFunction(text);
  if (errors.length) throw new Error(errors.join('; '));
  mkdirSync(fnDir(dir), { recursive: true });
  writeFileSync(file, text);
  writeIndex(dir);
  return file;
}

const INDEX_HEAD = `# Functions

Reusable prompts and small algorithms the agents (or you) noticed they keep
rewriting, saved once and called by name. One file per function in this
folder, written as:

\`\`\`
function nameInCamelCase( param : Type ) {
  ---
  What it does.
  Creation date : YYYY-MM-DD HH:MM:SS
  Created by : <who>
  Last usage : 0000-00-00 00:00:00
  ---
  The prompt, using the parameters, saying what is returned.
}
\`\`\`

Create one with \`node scripts/functions.mjs new <name> --params "a : Type" --desc "..."\`;
validate with \`check\` (the gate runs it). Record a use with \`use <name>\` — the
real last-usage time lives in the local usage log, shown by \`list\` and in the
ai-dash viewer, so the files don't change on every call. Pick the right home first:
a procedure with steps is a **skill**; a deterministic algorithm is a **script**;
only a short, parameterised prompt belongs here. This table is generated
(\`node scripts/functions.mjs index\`) — don't edit it by hand.

| Function | Parameters | Description | Created | By |
|---|---|---|---|---|
`;

export function writeIndex(dir) {
  const rows = listFunctions(dir).map((f) => `| [\`${f.name}\`](${f.file}) | ${f.params.join(', ') || '—'} | ${f.description.replace(/\|/g, '\\|')} | ${f.creationDate} | ${f.createdBy} |`);
  mkdirSync(fnDir(dir), { recursive: true });
  writeFileSync(join(fnDir(dir), 'README.md'), INDEX_HEAD + rows.join('\n') + (rows.length ? '\n' : ''));
}

function die(msg) { console.error(`functions: ${msg}`); process.exit(1); }

function main() {
  const [, , cmd, ...argv] = process.argv;
  const f = { dir: '.', rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') f.json = true;
    else if (['--dir', '--params', '--desc', '--prompt', '--by'].includes(a)) f[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die(`unknown argument: ${a}`);
    else f.rest.push(a);
  }
  if (cmd === 'new') {
    try {
      const params = f.params ? f.params.split(',').map((p) => p.trim()).filter(Boolean) : [];
      console.log(`created ${createFunction(f.dir, { name: f.rest[0], params, description: f.desc, prompt: f.prompt, by: f.by })}`);
    } catch (e) { die(e.message); }
  } else if (cmd === 'use') {
    if (!f.rest[0]) die('usage: use <name>');
    recordUse('function', f.rest[0], f.dir);
  } else if (cmd === 'index') {
    writeIndex(f.dir);
  } else if (cmd === 'list' || cmd === 'check') {
    const list = listFunctions(f.dir);
    if (f.json) console.log(JSON.stringify({ functions: list }, null, 2));
    else if (cmd === 'list') {
      for (const x of list) console.log(`${x.name}( ${x.params.join(', ')} )  (created ${x.creationDate}, last used ${x.lastUsage})\n  ${x.description}`);
      if (!list.length) console.log('No functions in docs/functions/.');
    } else {
      for (const x of list) for (const e of x.errors) console.error(`FAIL: docs/functions/${x.file}: ${e}`);
      if (!list.some((x) => x.errors.length)) console.log(`ok:   ${list.length} function${list.length === 1 ? '' : 's'}, format valid`);
    }
    if (cmd === 'check' && list.some((x) => x.errors.length)) process.exit(1);
  } else {
    console.log('Usage: node scripts/functions.mjs new|list|check|use|index  (see the header of this file)');
    process.exit(cmd ? 1 : 0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
