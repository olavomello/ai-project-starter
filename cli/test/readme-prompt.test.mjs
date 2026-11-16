// The README's "create the project with an AI agent" prompt is a copy of the bootstrap prompt in PROMPTS.md.
// Two copies drift; this keeps them identical so a change to one is a change to both.
//
// Run: node --test cli/test/readme-prompt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function bootstrapPrompt() {
  const prompts = read('PROMPTS.md');
  const section = prompts.indexOf('## Bootstrap a new project');
  assert.ok(section >= 0, 'PROMPTS.md has the bootstrap entry');
  const start = prompts.indexOf('```\n', section) + 4;
  return prompts.slice(start, prompts.indexOf('\n```', start));
}

test('the bootstrap prompt is the first way to create a project in the README Quick start', () => {
  const readme = read('README.md');
  const quick = readme.indexOf('## Quick start');
  const step1 = readme.indexOf('### 1. Create the project', quick);
  const agentWay = readme.indexOf('**With an AI agent', step1);
  const cliWay = readme.indexOf('**CLI (Node + git only', step1);
  assert.ok(step1 > quick && agentWay > step1, 'the agent option is in step 1');
  assert.ok(cliWay > agentWay, 'it comes before the CLI and the bash script');
  assert.ok(readme.includes('Three ways to do this'));
});

test('the prompt in the README is the one in PROMPTS.md, word for word', () => {
  const prompt = bootstrapPrompt();
  assert.ok(prompt.startsWith('I want to start a new project from the ai-project-starter template'));
  assert.ok(prompt.includes('ai-project-starter.git') && prompt.includes('adopt'), 'it is the full prompt, not a stub');
  const readme = read('README.md');
  assert.ok(readme.includes('```text\n' + prompt + '\n```'), 'README.md and PROMPTS.md carry different bootstrap prompts');
});
