import { expect, test } from 'claude-code/testing'
import { applyKey, editorOf, viewOf } from '../hooks/lib/editor.js'

const type = (state: { text: string; cursor: number }, ...keys: string[]) =>
  keys.reduce((s, key) => applyKey(s, { key }), state)

test('typing, Enter and Backspace edit a multi-line text', async () => {
  let s = type(editorOf(), 'h', 'i', 'return', 'y', 'o')
  expect(s.text).toBe('hi\nyo')
  s = type(s, 'backspace', 'backspace', 'backspace')
  expect(s.text).toBe('hi')
  expect(s.cursor).toBe(2)
})

test('arrows move within and across lines, Home and End go to the line edges', async () => {
  let s = editorOf('abc\nde\nfghi')
  s = type(s, 'up', 'up') // from the end of line 3 (column 4) to the top
  expect(s.cursor).toBe(2) // clamped to the end of 'de' on the way, then column 2 of 'abc'
  s = type(s, 'end')
  expect(s.cursor).toBe(3)
  s = type(s, 'down', 'home')
  expect(s.cursor).toBe(4)
  s = type(s, 'left', 'right', 'right', 'delete')
  expect(s.text).toBe('abc\nd\nfghi')
})

test('a paste with line breaks goes in whole, and named keys are not typed', async () => {
  let s = applyKey(editorOf('x'), { key: 'one\r\ntwo' })
  expect(s.text).toBe('xone\ntwo')
  const same = applyKey(s, { key: 'pageup' })
  expect(same).toBe(s)
  expect(applyKey(s, { key: 'c', ctrl: true })).toBe(s)
})

test('the view wraps long lines and scrolls to keep the caret on screen', async () => {
  const s = editorOf('a'.repeat(20) + '\nb\nc\nd')
  const view = viewOf(s, 8, 3)
  expect(view).toHaveLength(3)
  expect(view[2]).toEqual({ text: 'd', cursor: 1 })
  expect(view.filter((row) => row.cursor !== -1)).toHaveLength(1)
  expect(viewOf(editorOf(''), 10, 3)).toEqual([{ text: '', cursor: 0 }])
})

test('the space bar, named "space" by the engine, types a space', async () => {
  const s = type(editorOf(), 'a', 'space', 'b')
  expect(s.text).toBe('a b')
  expect(type(s, 'shift').text).toBe('a b')
})
