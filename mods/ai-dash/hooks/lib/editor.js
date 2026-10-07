// A small multi-line text editor, as pure functions: the state is `{ text, cursor }` (cursor = offset into
// text) and a key event moves or edits it. The Instructions field on the approval screen draws it, because a
// mod's own Input is a single line and an instruction can be a whole prompt. surface.js (editor.jsx) wires
// these to the keyboard; nothing here touches the engine, so tests run them directly.

export const MAX_TEXT = 4000;

const NAMED = new Set([
  'up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete', 'home', 'end',
  'pageup', 'pagedown', 'escape', 'insert', 'shift', 'control', 'alt', 'meta', 'capslock',
]);

export const editorOf = (text = '') => ({ text: String(text).slice(0, MAX_TEXT), cursor: Math.min(String(text).length, MAX_TEXT) });

const insert = (state, chunk) => {
  const room = MAX_TEXT - state.text.length;
  if (room <= 0 || chunk === '') return state;
  const piece = chunk.slice(0, room);
  return { text: state.text.slice(0, state.cursor) + piece + state.text.slice(state.cursor), cursor: state.cursor + piece.length };
};

/** [start, end) offsets of the logical line holding `at`. */
function lineAt(text, at) {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const next = text.indexOf('\n', at);
  return [start, next === -1 ? text.length : next];
}

function vertical(state, delta) {
  const { text, cursor } = state;
  const [start, end] = lineAt(text, cursor);
  const column = cursor - start;
  if (delta < 0) {
    if (start === 0) return { ...state, cursor: 0 };
    const [prevStart, prevEnd] = lineAt(text, start - 1);
    return { ...state, cursor: Math.min(prevStart + column, prevEnd) };
  }
  if (end >= text.length) return { ...state, cursor: text.length };
  const [nextStart, nextEnd] = lineAt(text, end + 1);
  return { ...state, cursor: Math.min(nextStart + column, nextEnd) };
}

/** Applies one key event (`{ key, ctrl?, meta?, shift? }`) and returns the next state (the same object when nothing changed). */
export function applyKey(state, event) {
  const key = event.key;
  if (event.ctrl || event.meta) {
    if (event.ctrl && key === 'u') return { text: state.text.slice(state.cursor), cursor: 0 }; // clear to the line's start, as in a shell
    return state;
  }
  switch (key) {
    case 'space':
      return insert(state, ' '); // the engine names the space bar
    case 'return':
    case 'enter':
      return insert(state, '\n');
    case 'tab':
      return insert(state, '  ');
    case 'backspace':
      return state.cursor === 0 ? state : { text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor), cursor: state.cursor - 1 };
    case 'delete':
      return state.cursor >= state.text.length ? state : { ...state, text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1) };
    case 'left':
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case 'right':
      return { ...state, cursor: Math.min(state.text.length, state.cursor + 1) };
    case 'up':
      return vertical(state, -1);
    case 'down':
      return vertical(state, 1);
    case 'home':
      return { ...state, cursor: lineAt(state.text, state.cursor)[0] };
    case 'end':
      return { ...state, cursor: lineAt(state.text, state.cursor)[1] };
    default:
      if (NAMED.has(key) || /^f\d{1,2}$/.test(key)) return state;
      return insert(state, key.replace(/\r\n?/g, '\n')); // one typed character, or a paste
  }
}

/**
 * The rows to draw: the text wrapped to `cols`, scrolled so the cursor stays inside `rows`. Each row is
 * `{ text, cursor }` where `cursor` is the column of the caret on that row, or -1.
 */
export function viewOf(state, cols, rows) {
  const width = Math.max(cols, 8);
  const lines = [];
  let offset = 0;
  for (const line of state.text.split('\n')) {
    let from = 0;
    do {
      const chunk = line.slice(from, from + width);
      lines.push({ text: chunk, start: offset + from, end: offset + from + chunk.length, last: from + width >= line.length });
      from += width;
    } while (from < line.length);
    offset += line.length + 1;
  }
  // The caret sits on the row whose range holds it; at a wrap point it belongs to the row that starts there.
  let caretRow = lines.findIndex((row) => state.cursor >= row.start && (state.cursor < row.end || (state.cursor === row.end && row.last)));
  if (caretRow === -1) caretRow = lines.length - 1;
  const top = Math.max(0, Math.min(caretRow - rows + 1, lines.length - rows));
  return lines.slice(top, top + rows).map((row, i) => ({ text: row.text, cursor: top + i === caretRow ? state.cursor - row.start : -1 }));
}
