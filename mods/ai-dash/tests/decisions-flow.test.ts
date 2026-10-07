import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const FILE = 'docs/pending-decisions.md'
/** AI Dash's approval queue lives next to the decisions file, not in it. */
const isInbox = (path: string): boolean => path.endsWith('decisions-inbox.jsonl')
const START = [
  '# Pending decisions',
  '',
  '## Needed before going live',
  '',
  '| Item | What is needed | Blocks |',
  '|---|---|---|',
  '| Fly.io | Create the account | API deploy |',
  '| Stripe | Account keys | Real payments |',
  '',
].join('\n')

/** The file system and the prompt box, standing in for the engine beneath the mod. */
function engine(on: On) {
  const state = { disk: START, prompts: [] as string[], writes: 0 }
  mock.clock(on, { now: 1_000 })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.exists', async (_$, e) => ({ value: !isInbox(e.path) }))
  on('fs.read', async () => ({ value: state.disk }))
  on('fs.stat', async () => ({
    value: { kind: 'file' as const, size: state.disk.length, mtimeMs: state.writes, isLink: false },
  }))
  on('fs.write', async (_$, e) => {
    state.disk = e.text
    state.writes += 1

    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => {
    state.prompts.push(e.text)

    return { text: e.text }
  })

  return state
}

test('the band counts the items, View opens the list and Approve hands one to the agent', { options: { showWhenMissing: true } }, async ($, on) => {
  const fake = engine(on)
  const band = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'AbovePrompt',
    // the engine fills the other props; the mod only reads hasSurvey
    props: { hasSurvey: false } as never,
  })

  // Refresh reads the file; only then does the band know the count.
  await band.press({ key: 'refresh' })
  expect((await band.find({ type: 'Text', text: /Pending decisions : 2/ }))?.text).toContain('2')

  const pane = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'Pane',
    props: {} as never,
    requestId: 'decisions',
  })
  expect(await pane.find({ type: 'Text', text: /Fly\.io/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Stripe/ })).toBeDefined()

  // Approve asks first: nothing is sent or removed until Y.
  const fly = (await pane.findAll({ type: 'Button', text: /Approve/ }))[0]
  expect(fly).toBeDefined()
  await pane.press({ key: fake.disk.includes('Fly.io') ? approveKeyFor(fake.disk, 'Fly.io') : '' })
  expect(await pane.find({ type: 'Text', text: /Confirm approval\?/ })).toBeDefined()
  expect(fake.prompts).toEqual([])
  expect(fake.disk).toContain('Fly.io')

  // N goes back to the list and keeps everything.
  await pane.press({ key: 'confirm-no' })
  expect(await pane.find({ type: 'Text', text: /Fly\.io/ })).toBeDefined()
  expect(fake.prompts).toEqual([])

  // Y sends the item to the agent and takes its row out of the file.
  await pane.press({ key: approveKeyFor(fake.disk, 'Fly.io') })
  await pane.press({ key: 'confirm-yes' })
  expect(fake.prompts).toHaveLength(1)
  expect(fake.prompts[0]).toContain('Item: Fly.io')
  expect(fake.prompts[0]).toContain(FILE)
  expect(fake.disk).not.toContain('Fly.io')
  expect(fake.disk).toContain('Stripe')

  await band.press({ key: 'refresh' })
  expect(await band.find({ type: 'Text', text: /Pending decisions : 1/ })).toBeDefined()
})

test('Close on the confirmation returns to the list, Close on the list closes the pane', async ($, on) => {
  const fake = engine(on)
  const pane = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'Pane',
    props: {} as never,
    requestId: 'decisions',
  })
  await pane.press({ key: 'pane-refresh' })
  await pane.press({ key: approveKeyFor(fake.disk, 'Stripe') })
  expect(await pane.find({ type: 'Text', text: /Confirm approval\?/ })).toBeDefined()
  await pane.press({ key: 'pane-close' })
  expect(await pane.find({ type: 'Text', text: /Stripe/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Confirm approval\?/ })).toBeUndefined()
  expect(fake.prompts).toEqual([])
})

/** The Approve button's key is `approve:` and the id the mod gives the row: a hash of its line. */
function approveKeyFor(disk: string, title: string): string {
  const line = disk.split('\n').find(one => one.includes(`| ${title} |`)) ?? ''
  let hash = 5381
  for (let i = 0; i < line.length; i += 1) hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0

  return `approve:${(hash >>> 0).toString(36)}`
}

test('a project without the decisions file shows no Pending decisions band at all', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('ui.toast', async () => ({ value: undefined }))
  const band = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false } as never,
  })
  expect(await band.find({ type: 'Text', text: /Pending decisions/ })).toBeUndefined()
})

test('an item approved in AI Dash reaches the session through the queue, once', { options: { showWhenMissing: true } }, async ($, on) => {
  const state = {
    inbox: `${JSON.stringify({ ts: 1, id: 'abc', title: 'Fly.io', prompt: 'PROMPT FROM AI DASH' })}\nnot json\n`,
    prompts: [] as string[],
  }
  mock.clock(on, { now: 1_000 })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async (_$, e) => ({ value: isInbox(e.path) ? state.inbox : START }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.write', async (_$, e) => {
    if (isInbox(e.path)) state.inbox = e.text

    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => {
    state.prompts.push(e.text)

    return { text: e.text }
  })
  const band = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false } as never,
  })
  await band.press({ key: 'refresh' })
  expect(state.prompts).toEqual(['PROMPT FROM AI DASH'])
  expect(state.inbox).toBe('')
  await band.press({ key: 'refresh' })
  expect(state.prompts).toHaveLength(1)
})

test('pressing a detail line shows it in full, and hide details folds it back', async ($, on) => {
  const fake = engine(on)
  const pane = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'Pane',
    props: {} as never,
    requestId: 'decisions',
  })
  await pane.press({ key: 'pane-refresh' })
  expect(fake.disk).toContain('Create the account')
  const more = (await pane.findAll({ type: 'Button', text: /Create the account/ }))[0]
  expect(more).toBeDefined()
  const id = more!.key.replace('more:', '')
  await pane.press({ key: `more:${id}` })
  expect(await pane.find({ type: 'Button', text: /hide details/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Create the account/ })).toBeDefined()
  await pane.press({ key: `less:${id}` })
  expect(await pane.find({ type: 'Button', text: /hide details/ })).toBeUndefined()
})

test('Approve with instructions hands the agent the item and the Administrator\'s words, Approve only does not', async ($, on) => {
  const fake = engine(on)
  const pane = await $.ui.mount({
    plugin: 'ai-dash',
    surface: 'terminal',
    component: 'Pane',
    props: {} as never,
    requestId: 'decisions',
  })
  await pane.press({ key: 'pane-refresh' })

  // With instructions: typed in the field, sent with the second button.
  await pane.press({ key: approveKeyFor(fake.disk, 'Fly.io') })
  await pane.input({ key: 'confirm-note', text: 'Use region gru and the free tier', kind: 'change' })
  await pane.press({ key: 'confirm-note-yes' })
  expect(fake.prompts).toHaveLength(1)
  expect(fake.prompts[0]).toContain('Item: Fly.io')
  expect(fake.prompts[0]).toContain('Use region gru and the free tier')
  expect(fake.prompts[0]).toContain('added instructions')
  expect(fake.disk).not.toContain('Fly.io')

  // Approve only: nothing but the item, even though the field was left empty.
  await pane.press({ key: approveKeyFor(fake.disk, 'Stripe') })
  await pane.press({ key: 'confirm-yes' })
  expect(fake.prompts).toHaveLength(2)
  expect(fake.prompts[1]).toContain('Item: Stripe')
  expect(fake.prompts[1]).not.toContain('added instructions')
})
