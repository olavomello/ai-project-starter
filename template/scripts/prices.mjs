#!/usr/bin/env node
// Model prices: docs/model-prices.json, read and edited from AI Dash (Settings > Model prices).
//
// The file maps a model name, exactly as the usage log records it, to USD per 1,000,000 tokens:
//   { "updated": "2026-10-07", "models": { "claude-sonnet-5-5": { "in": 3, "out": 15, "cache_read": 0.3, "cache_write": 3.75 } } }
// `updated` is the date the numbers were last entered (the editor sets it on every save). scripts/ai-report.mjs
// prices each execution with its model's entry; a model with no entry stays unpriced.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PRICES_FILE = 'docs/model-prices.json';
export const FIELDS = ['in', 'out', 'cache_read', 'cache_write'];
export const MAX_MODELS = 80;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const MAX_PRICE = 100000; // USD per million tokens: far above any real price, below anything that overflows a report

/** The prices of the project at `root`: `{ exists, updated, models, error? }`. */
export function readPrices(root) {
  const path = join(root, PRICES_FILE);
  if (!existsSync(path)) return { exists: false, updated: '', models: {} };
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const models = {};
    for (const [name, value] of Object.entries(json.models || {})) {
      if (name.startsWith('example') || !value || typeof value !== 'object') continue;
      models[name] = Object.fromEntries(FIELDS.map((field) => [field, Number(value[field]) || 0]));
    }
    return { exists: true, updated: typeof json.updated === 'string' ? json.updated : '', models };
  } catch {
    return { exists: true, updated: '', models: {}, error: `${PRICES_FILE} is not valid JSON` };
  }
}

/** Checks `{ models }` from the editor. Returns `{ ok: true, models }` or `{ ok: false, error }`. */
export function parseModels(input) {
  const raw = input && typeof input === 'object' ? input.models : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'expected { "models": { "<name>": { in, out, cache_read, cache_write } } }' };
  const names = Object.keys(raw);
  if (names.length > MAX_MODELS) return { ok: false, error: `at most ${MAX_MODELS} models` };
  const models = {};
  for (const name of names) {
    if (!NAME.test(name)) return { ok: false, error: `"${name}" is not a model name (letters, digits and . _ : / - only)` };
    const row = raw[name];
    if (!row || typeof row !== 'object') return { ok: false, error: `"${name}": expected the four prices` };
    models[name] = {};
    for (const field of FIELDS) {
      const value = row[field] === undefined || row[field] === '' ? 0 : Number(row[field]);
      if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE) return { ok: false, error: `"${name}": ${field} must be a number from 0 to ${MAX_PRICE}` };
      models[name][field] = value;
    }
  }
  return { ok: true, models };
}

const today = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Writes the models, keeping the file's other keys (its notes) and stamping `updated` with today's date. */
export function writePrices(root, models, now = new Date()) {
  const path = join(root, PRICES_FILE);
  let current = {};
  try { current = JSON.parse(readFileSync(path, 'utf8')); } catch { /* a new or unreadable file starts fresh */ }
  const { models: _old, updated: _date, ...notes } = current && typeof current === 'object' ? current : {};
  const updated = today(now);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...notes, updated, models }, null, 2)}\n`);
  return { updated, models };
}
