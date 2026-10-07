// Pure helpers that turn a markdown file of pending decisions into a list, and take one item out of
// it again. Nothing here touches the engine, so the rules can be unit-tested on their own.
//
// An item is a table row (the first row of each table is its header and is skipped) or a bullet
// (`-`, `*`, `+` or a numbered line, with an optional `[ ]` checkbox) found outside code fences.
// Its group is the section heading above it. Nothing here is specific to one project.

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

/** A short, stable id for a line: the same text gives the same id on every refresh. */
export function hashLine(line) {
  let hash = 5381;
  for (let i = 0; i < line.length; i += 1) {
    hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === '\\' && inner[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (char === '|') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cleanText);
}

function isRow(line) {
  const text = line.trim();
  return text.length > 2 && text.startsWith('|') && text.endsWith('|');
}

/** @returns {{id:string, section:string, group:number, title:string, detail:string, blocks:string, raw:string}[]} */
export function parseItems(markdown) {
  const items = [];
  let section = '';
  let group = -1;
  let inFence = false;
  let inTable = false;

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      inTable = false;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      section = cleanText(heading[1] || '');
      group += 1;
      inTable = false;
      continue;
    }

    if (isRow(line)) {
      if (!inTable) {
        inTable = true; // the header row of a new table
        continue;
      }
      if (SEPARATOR.test(line.trim())) continue;
      const cells = splitRow(line);
      const title = cells[0] || '';
      if (title === '') continue;
      items.push({
        id: hashLine(line),
        section,
        group: Math.max(group, 0),
        title,
        detail: cells[1] || '',
        blocks: cells.length > 2 ? cells[cells.length - 1] || '' : '',
        raw: line,
      });
      continue;
    }
    inTable = false;

    const bullet = BULLET.exec(line);
    if (bullet) {
      const title = cleanText(bullet[1] || '');
      if (title === '') continue;
      items.push({
        id: hashLine(line),
        section,
        group: Math.max(group, 0),
        title,
        detail: '',
        blocks: '',
        raw: line,
      });
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

/** The prompt that hands an approved item to the agent. */
export function buildPrompt(item, file) {
  const parts = [
    `The Administrator approved this pending decision from ${file} through the Pending decisions band.`,
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

/** The display rows of a long list: a heading before each new section, then its items. */
export function toEntries(items) {
  const entries = [];
  let last = null;
  for (const item of items) {
    const key = `${item.group}:${item.section}`;
    if (key !== last) {
      entries.push({ kind: 'heading', text: item.section || 'Pending', group: item.group });
      last = key;
    }
    entries.push({ kind: 'item', item });
  }
  return entries;
}

const rowsOf = (entry) => (entry.kind === 'heading' ? 1 : 2);

/** Windows the display rows so a long list fits a pane: headings take 1 row, items 2. */
export function windowEntries(entries, offset, room) {
  const start = Math.min(Math.max(offset, 0), Math.max(entries.length - 1, 0));
  const shown = [];
  let used = 0;
  for (let i = start; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry) break;
    if (used + rowsOf(entry) > room && shown.length > 0) break;
    shown.push(entry);
    used += rowsOf(entry);
  }
  return { shown, start, end: start + shown.length };
}
