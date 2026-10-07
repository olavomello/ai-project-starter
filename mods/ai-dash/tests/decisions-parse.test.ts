import { expect, test } from 'claude-code/testing'

import {
  buildPrompt,
  cleanText,
  hashLine,
  parseItems,
  removeLine,
  toEntries,
  windowEntries,
} from '../hooks/lib/decisions-parse.js'

const SAMPLE = [
  '# Pending decisions',
  '',
  'Intro text with no bullets.',
  '',
  '## Needed before going live',
  '',
  '| Item | What is needed | Blocks |',
  '|---|---|---|',
  '| **Fly.io** | Create the account and `FLY_API_TOKEN` | API deploy |',
  '| Stripe | Keys, never in the [repo](https://x.test) | Real payments |',
  '',
  '## Decisions to take',
  '',
  '| Item | Question | Blocks |',
  '|---|---|---|',
  '| Admin role | Who is an admin? | Admin screens |',
  '',
  '```',
  '| not | an | item |',
  '- not a bullet either',
  '```',
  '',
  '## Notes',
  '',
  '- [ ] Rotate the salt',
  '- Plain bullet',
].join('\n')

test('counts the table rows and bullets, skipping headers, separators and code fences', async () => {
  const items = parseItems(SAMPLE)
  expect(items.map(item => item.title)).toEqual([
    'Fly.io',
    'Stripe',
    'Admin role',
    'Rotate the salt',
    'Plain bullet',
  ])
})

test('keeps the detail, what it blocks and the section of each item', async () => {
  const [first, , third] = parseItems(SAMPLE)
  expect(first?.detail).toBe('Create the account and FLY_API_TOKEN')
  expect(first?.blocks).toBe('API deploy')
  expect(first?.section).toBe('Needed before going live')
  expect(third?.section).toBe('Decisions to take')
  expect(first?.group).not.toBe(third?.group)
})

test('strips markdown from cells', async () => {
  expect(cleanText('**Bold** `code` [link](https://x.test) ~~old~~')).toBe('Bold code link old')
})

test('ids are stable for the same line and differ between lines', async () => {
  expect(hashLine('| a | b |')).toBe(hashLine('| a | b |'))
  expect(hashLine('| a | b |')).not.toBe(hashLine('| a | c |'))
})

test('removes exactly one line and reports a line that is gone', async () => {
  const item = parseItems(SAMPLE)[1]
  const next = removeLine(SAMPLE, item?.raw ?? '')
  expect(next).not.toBeNull()
  expect(parseItems(next ?? '').map(one => one.title)).toEqual([
    'Fly.io',
    'Admin role',
    'Rotate the salt',
    'Plain bullet',
  ])
  expect(removeLine(next ?? '', item?.raw ?? '')).toBeNull()
})

test('an escaped pipe stays inside its cell', async () => {
  const [item] = parseItems(['## A', '', '| H | H2 |', '|---|---|', '| a \\| b | c |'].join('\n'))
  expect(item?.title).toBe('a | b')
  expect(item?.detail).toBe('c')
})

test('an empty or item-less file has no items', async () => {
  expect(parseItems('')).toEqual([])
  expect(parseItems('# Title\n\nJust prose.')).toEqual([])
})

test('the prompt carries the item and tells the agent what to do when blocked', async () => {
  const [item] = parseItems(SAMPLE)
  const prompt = buildPrompt(item!, 'docs/pending-decisions.md')
  expect(prompt).toContain('Item: Fly.io')
  expect(prompt).toContain('Blocks: API deploy')
  expect(prompt).toContain('already been removed from docs/pending-decisions.md')
  expect(prompt).toContain('add a new row to docs/pending-decisions.md')
})

test('windows the entries to the room, never starting past the end', async () => {
  const entries = toEntries(parseItems(SAMPLE))
  const first = windowEntries(entries, 0, 5)
  expect(first.start).toBe(0)
  expect(first.shown.length).toBeGreaterThan(0)
  expect(first.end).toBe(first.shown.length)
  const beyond = windowEntries(entries, 999, 5)
  expect(beyond.start).toBe(entries.length - 1)
  const all = windowEntries(entries, 0, 999)
  expect(all.shown.length).toBe(entries.length)
})
