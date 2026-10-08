#!/usr/bin/env node
// Turns a roster agent on or off from AI Dash (the Agents card).
//
// The status lives where the roster keeps it: the `Status : ON|OFF` line in the CONFIGS block of
// docs/agents/<name>.md. Changing it here rewrites that one line and then runs the same sync as
// `node scripts/agents-sync.mjs`, so the Claude Code pointer in .claude/agents/ appears (ON) or goes
// (OFF) with it. Nothing else in the file is touched.
//
// Usage:
//   node scripts/agents-status.mjs list [--json]
//   node scripts/agents-status.mjs <name> on|off
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { field, syncClaudeAgents, ROSTER_DIR } from './agents-sync.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;
const STATUS_LINE = /^(Status[ \t]*:[ \t]*)([^\r\n]*)$/m;

const fileOf = (dir, name) => join(dir, ROSTER_DIR, `${name}.md`);

/** Every roster agent with what the Agents card shows. */
export function listAgents(dir = '.') {
  const rosterDir = join(dir, ROSTER_DIR);
  if (!existsSync(rosterDir)) return [];
  return readdirSync(rosterDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .map((f) => {
      const text = readFileSync(join(rosterDir, f), 'utf8');
      return {
        name: f.slice(0, -3),
        description: field(text, 'Description'),
        status: field(text, 'Status'),
        owns: field(text, 'Owns'),
        createdBy: field(text, 'Created by'),
        creationDate: field(text, 'Creation date'),
      };
    });
}

/**
 * Sets an agent's Status to ON or OFF and syncs `.claude/agents/`. Returns `{ ok, name, status, changed }`
 * or `{ ok: false, error }`; nothing is written when the request is refused.
 */
export function setAgentStatus(dir, name, status) {
  if (typeof name !== 'string' || !NAME.test(name)) return { ok: false, error: 'not an agent name' };
  if (status !== 'ON' && status !== 'OFF') return { ok: false, error: 'status must be ON or OFF' };
  const path = fileOf(dir, name);
  if (!existsSync(path)) return { ok: false, error: `no agent ${name} in ${ROSTER_DIR}/` };
  const text = readFileSync(path, 'utf8');
  if (!STATUS_LINE.test(text)) return { ok: false, error: `${name} has no "Status :" line in its CONFIGS block` };
  const next = text.replace(STATUS_LINE, `$1${status}`);
  const changed = next !== text;
  if (changed) writeFileSync(path, next);
  syncClaudeAgents(dir); // repairs the mirror either way, so a hand-edited status is picked up too
  return { ok: true, name, status, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, second, ...rest] = process.argv.slice(2);
  if (first === 'list') {
    const agents = listAgents('.');
    if (second === '--json' || rest.includes('--json')) console.log(JSON.stringify(agents));
    else for (const a of agents) console.log(`${a.status.padEnd(4)} ${a.name}  ${a.description}`);
  } else if (first && ['on', 'off'].includes(String(second).toLowerCase())) {
    const r = setAgentStatus('.', first, String(second).toUpperCase());
    console.log(r.ok ? `${r.name}: ${r.status}${r.changed ? '' : ' (already)'}` : `error: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  } else {
    console.log('Usage: node scripts/agents-status.mjs list [--json] | <name> on|off');
    process.exit(first ? 1 : 0);
  }
}
