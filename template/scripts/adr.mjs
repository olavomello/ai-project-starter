#!/usr/bin/env node
// Lightweight Architecture Decision Record (ADR) manager. Follows the
// numbering, file-naming and supersede conventions of npryce/adr-tools
// (https://github.com/npryce/adr-tools), reimplemented here in
// dependency-free Node instead of bash, for the same cross-platform reason
// the rest of this starter's scripts are Node: it runs the same on
// Windows, macOS and Linux.
//
// Usage:
//   node scripts/adr.mjs new "<title>" [--status <status>] [--supersedes <NNNN>]
//   node scripts/adr.mjs list
//   node scripts/adr.mjs toc [--write]
//
// See docs/adr/0001-record-architecture-decisions.md for why this exists.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ADR_DIR = 'docs/adr';
const TEMPLATE = join(ADR_DIR, 'template.md');
const NUM_RE = /^(\d{4})-.*\.md$/;

function die(msg) { console.error(`adr: ${msg}`); process.exit(1); }

function slugify(title) {
  return title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listAdrs() {
  if (!existsSync(ADR_DIR)) return [];
  return readdirSync(ADR_DIR).filter((f) => NUM_RE.test(f)).sort();
}

function nextNumber() {
  const nums = listAdrs().map((f) => parseInt(f.match(NUM_RE)[1], 10));
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

function pad(n) { return String(n).padStart(4, '0'); }

function titleOf(text, fallback) {
  return (text.match(/^# (.*)$/m) || [, fallback])[1] || fallback;
}

function statusOf(text) {
  return (text.match(/## Status\s*\n\n(.*)/) || [, '?'])[1].trim();
}

function setStatus(text, status) {
  return text.replace(/(## Status\s*\n\n)([\s\S]*?)(\n\n## Context)/, `$1${status}$3`);
}

function cmdNew(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') flags.status = args[++i];
    else if (args[i] === '--supersedes') flags.supersedes = args[++i];
    else rest.push(args[i]);
  }
  const title = rest.join(' ').trim();
  if (!title) die('usage: adr new "<title>" [--status <status>] [--supersedes <NNNN>]');
  if (!existsSync(TEMPLATE)) die(`no template at ${TEMPLATE} — was docs/adr/ removed?`);

  const num = nextNumber();
  const slug = slugify(title);
  const fileName = `${pad(num)}-${slug}.md`;
  const filePath = join(ADR_DIR, fileName);

  let body = readFileSync(TEMPLATE, 'utf8');
  body = body.replace(/^# .*$/m, `# ${num}. ${title}`);
  if (flags.status) body = setStatus(body, flags.status);

  if (flags.supersedes) {
    const supNum = pad(parseInt(flags.supersedes, 10));
    const supFile = listAdrs().find((f) => f.startsWith(supNum));
    if (!supFile) die(`no ADR numbered ${supNum} to supersede`);
    const supPath = join(ADR_DIR, supFile);
    const supTitle = titleOf(readFileSync(supPath, 'utf8'), supFile);

    body = body.replace(
      /(## Context\s*\n\n)/,
      `$1Supersedes [${supTitle}](./${supFile}).\n\n`,
    );

    let supBody = setStatus(
      readFileSync(supPath, 'utf8'),
      `Superseded by [${num}. ${title}](./${fileName})`,
    );
    writeFileSync(supPath, supBody);
    console.log(`Marked ${supFile} as superseded.`);
  }

  mkdirSync(ADR_DIR, { recursive: true });
  writeFileSync(filePath, body);
  console.log(`Created ${filePath}`);
}

function cmdList() {
  const files = listAdrs();
  if (!files.length) { console.log('No ADRs yet. node scripts/adr.mjs new "<title>"'); return; }
  for (const f of files) {
    const text = readFileSync(join(ADR_DIR, f), 'utf8');
    console.log(`${f}  [${statusOf(text)}]  ${titleOf(text, f)}`);
  }
}

function cmdToc(args) {
  const files = listAdrs();
  const lines = ['# Architecture Decision Records', ''];
  for (const f of files) {
    const text = readFileSync(join(ADR_DIR, f), 'utf8');
    lines.push(`- [${titleOf(text, f)}](./${f}) — ${statusOf(text)}`);
  }
  const toc = lines.join('\n') + '\n';
  if (args.includes('--write')) {
    const out = join(ADR_DIR, 'README.md');
    writeFileSync(out, toc);
    console.log(`Wrote ${out}`);
  } else {
    console.log(toc);
  }
}

const HELP = `adr — lightweight Architecture Decision Records (adr-tools-style numbering).

Usage:
  node scripts/adr.mjs new "<title>" [--status <status>] [--supersedes <NNNN>]
  node scripts/adr.mjs list
  node scripts/adr.mjs toc [--write]
`;

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'new': cmdNew(rest); break;
  case 'list': cmdList(); break;
  case 'toc': cmdToc(rest); break;
  case undefined:
  case '--help':
  case '-h':
  case 'help':
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command "${cmd}".\n`);
    console.log(HELP);
    process.exit(1);
}
