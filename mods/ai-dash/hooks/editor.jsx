// The Instructions field of the approval screen: a multi-line editor drawn by the engine's Client element.
// Click it to give it the keyboard (Escape gives it back). Enter adds a line; every edit is posted to the
// hooks module, which keeps the text for the approval. The editing rules are in ./lib/editor.js.
import { applyKey, editorOf, viewOf } from './lib/editor.js';

const DEFAULT_ROWS = 8;

const Editor = (props, surface) => {
  const { Box, Text } = surface.elements;
  const rows = (props && typeof props.rows === 'number' ? props.rows : DEFAULT_ROWS);
  const placeholder = (props && typeof props.placeholder === 'string' ? props.placeholder : '');

  if (surface.state === undefined) {
    surface.setState(editorOf(props && typeof props.value === 'string' ? props.value : ''));
    surface.onKey((event) => {
      const current = surface.state;
      if (current === undefined) return;
      const next = applyKey(current, event);
      if (next === current) return;
      surface.setState(next);
      if (next.text !== current.text) surface.post({ text: next.text });
    });
  }
  const state = surface.state === undefined ? editorOf('') : surface.state;
  const shown = viewOf(state, (surface.columns || 60) - 1, rows);

  return (
    <Box flexDirection="column">
      {state.text === '' ? (
        <Text>
          <Text inverse> </Text>
          <Text dimColor>{` ${placeholder}`}</Text>
        </Text>
      ) : (
        shown.map((row, i) => (
          <Text key={`r${i}`}>
            {row.cursor === -1 ? row.text : row.text.slice(0, row.cursor)}
            {row.cursor !== -1 && <Text inverse>{row.cursor < row.text.length ? row.text.charAt(row.cursor) : ' '}</Text>}
            {row.cursor !== -1 && row.text.slice(row.cursor + 1)}
          </Text>
        ))
      )}
    </Box>
  );
};

export default Editor;
