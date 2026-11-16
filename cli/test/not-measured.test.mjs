// A run logged with no model or tokens must read "not measured" in AI Dash, not a model called "unknown".
//
// Run: node --test cli/test/not-measured.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = readFileSync(fileURLToPath(new URL('../../template/ai-dash/index.html', import.meta.url)), 'utf8');

test('Recent executions shows "not measured" for runs with no model or tokens', () => {
  assert.match(page, /<td>\$\{modelCell\(r\)\}<\/td>/, 'the model column goes through modelCell');
  assert.match(page, /<td class="n">\$\{tokensCell\(r\)\}<\/td>/, 'the tokens column goes through tokensCell');
  assert.match(page, />not measured<\/span>/);
  assert.match(page, /r\.model !== "unknown"/, 'the placeholder written by ai-log.mjs is recognised');
});

test('the Tokens-by-model chart labels the placeholder the same way', () => {
  assert.match(page, /segLabel = \(v\) => \(v === "unknown" \|\| !v \? "not measured" : v\)/);
  assert.equal((page.match(/esc\(segLabel\(r\[key\]\)\)/g) || []).length, 2, 'legend and tooltip both use it');
});
