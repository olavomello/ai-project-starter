#!/usr/bin/env node
// Pending decisions: the markdown file (default docs/pending-decisions.md) that lists what waits on
// the Administrator, read and approved from ai-dash.
//
// This is the same format the starter-hud mod's Pending decisions band reads. An item is a table row
// (the first row of each table is its header) or a bullet found outside code fences; its group is the
// section heading above it. Approving an item removes its row from the file and queues a prompt in
// `.agents/state/decisions-inbox.jsonl`; the mod, which watches the project from inside Claude Code,
// hands each queued prompt to the open session. No session open: the prompt waits in the queue.
//
//   node scripts/decisions.mjs list [--json]
//
// The parsing rules are mirrored in mods/starter-hud/hooks/lib/decisions-parse.js (a mod cannot import
// from here); cli/test/decisions.test.mjs checks both give the same answers.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usageRoot } from './skills.mjs';

export const DEFAULT_FILE = 'docs/pending-decisions.md';
export const INBOX = join('.agents', 'state', 'decisions-inbox.jsonl');

const SEPARATOR = /^\|[\s:|-]+\|$/;
const BULLET = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Strips the markdown a person does not need to read in a one-line list. */
export function cleanText(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short, stable id for a line: the same text gives the same id on every read. */
export function hashLine(line) {
  let hash = 5381;
  for (let i = 0; i < line.length; i += 1) hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === '\\' && inner[i + 1] === '|') { current += '|'; i += 1; }
    else if (char === '|') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells.map(cleanText);
}

const isRow = (line) => { const t = line.trim(); return t.length > 2 && t.startsWith('|') && t.endsWith('|'); };

/** @returns {{id:string, section:string, group:number, title:string, detail:string, blocks:string, raw:string}[]} */
export function parseItems(markdown) {
  const items = [];
  let section = '';
  let group = -1;
  let inFence = false;
  let inTable = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) { inFence = !inFence; inTable = false; continue; }
    if (inFence) continue;
    const heading = HEADING.exec(line);
    if (heading) { section = cleanText(heading[1] || ''); group += 1; inTable = false; continue; }
    if (isRow(line)) {
      if (!inTable) { inTable = true; continue; } // the header row of a new table
      if (SEPARATOR.test(line.trim())) continue;
      const cells = splitRow(line);
      const title = cells[0] || '';
      if (title === '') continue;
      items.push({ id: hashLine(line), section, group: Math.max(group, 0), title, detail: cells[1] || '', blocks: cells.length > 2 ? cells[cells.length - 1] || '' : '', raw: line });
      continue;
    }
    inTable = false;
    const bullet = BULLET.exec(line);
    if (bullet) {
      const title = cleanText(bullet[1] || '');
      if (title === '') continue;
      items.push({ id: hashLine(line), section, group: Math.max(group, 0), title, detail: '', blocks: '', raw: line });
    }
  }
  return items;
}

/** Removes the first line equal to `raw`. Returns null when the line is no longer there. */
export function removeLine(markdown, raw) {
  const lines = markdown.split('\n');
  const at = lines.indexOf(raw);
  if (at === -1) return null;
  lines.splice(at, 1);
  return lines.join('\n');
}

/** The prompt that hands an approved item to the agent. `via` names where the approval happened. */
export function buildPrompt(item, file, via = 'the Pending decisions band') {
  const parts = [
    `The Administrator approved this pending decision from ${file} through ${via}.`,
    '',
    `Item: ${item.title}`,
    item.detail ? `Details: ${item.detail}` : '',
    item.blocks ? `Blocks: ${item.blocks}` : '',
    item.section ? `Section: ${item.section}` : '',
    '',
    'Execute it now, following AGENTS.md: agents work in their own worktree, run the gate before any merge, and the decision and the changelog are recorded where the project says.',
    `The row has already been removed from ${file}.`,
    `If the item cannot be executed without something only the Administrator can provide (credentials, account access, files), do not guess: add a new row to ${file} that states exactly what is missing.`,
  ];
  return parts.filter((part, i) => part !== '' || parts[i - 1] !== '').join('\n');
}

const inboxPath = (dir) => join(usageRoot(dir), INBOX);

/** The decisions of the project at `dir`: `{ file, exists, items, queued }`; `queued` counts approvals no session has taken yet. */
export function readDecisions(dir = '.', file = DEFAULT_FILE) {
  const path = join(dir, file);
  let queued = 0;
  try { queued = readFileSync(inboxPath(dir), 'utf8').split('\n').filter(Boolean).length; } catch { /* no queue */ }
  if (!existsSync(path)) return { file, exists: false, items: [], queued };
  const items = parseItems(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
  return { file, exists: true, items: items.map(({ raw, ...rest }) => rest), queued };
}

/**
 * Approves one item: queues its prompt for the open Claude Code session, then removes its row from
 * the file. Refuses (`{ ok: false, error }`) when the item is gone or the file changed under it.
 */
export function approveDecision(dir, id, { file = DEFAULT_FILE, now = Date.now() } = {}) {
  const path = join(dir, file);
  if (!existsSync(path)) return { ok: false, error: `${file} not found` };
  const crlf = readFileSync(path, 'utf8').includes('\r\n');
  const markdown = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const item = parseItems(markdown).find((one) => one.id === id);
  if (!item) return { ok: false, error: 'that item is no longer in the file; the list was refreshed' };
  const next = removeLine(markdown, item.raw);
  if (next === null) return { ok: false, error: 'that item changed on disk; the list was refreshed' };

  const queue = inboxPath(dir);
  mkdirSync(dirname(queue), { recursive: true });
  appendFileSync(queue, `${JSON.stringify({ ts: now, id: item.id, title: item.title, prompt: buildPrompt(item, file, 'AI Dash') })}\n`);
  writeFileSync(path, crlf ? next.replace(/\n/g, '\r\n') : next);
  return { ok: true, title: item.title };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    const d = readDecisions('.');
    if (rest.includes('--json')) console.log(JSON.stringify(d));
    else if (!d.exists) console.log(`${d.file} not found`);
    else for (const i of d.items) console.log(`${i.id}  [${i.section}] ${i.title}${i.blocks ? `  (blocks: ${i.blocks})` : ''}`);
  } else {
    console.log('Usage: node scripts/decisions.mjs list [--json]');
    process.exit(cmd ? 1 : 0);
  }
}
