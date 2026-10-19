#!/usr/bin/env node
// Draws the AI Dash mark (three bars: purple, blue, green) as raw 32x32 RGBA into assets/icon.rgba,
// which main.rs embeds for the window and the tray. Run it again only when the mark changes.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 32;
const bars = [
  { x: 5, h: 14, rgb: [0x8b, 0x5c, 0xf6] },
  { x: 13, h: 22, rgb: [0x3b, 0x82, 0xf6] },
  { x: 21, h: 18, rgb: [0x22, 0xc5, 0x5e] },
];
const W = 6;
const BOTTOM = 29;
const px = Buffer.alloc(SIZE * SIZE * 4); // fully transparent

for (const b of bars) {
  for (let y = BOTTOM - b.h; y < BOTTOM; y++) {
    for (let x = b.x; x < b.x + W; x++) {
      // round the top corners by one pixel
      const corner = (y === BOTTOM - b.h) && (x === b.x || x === b.x + W - 1);
      if (corner) continue;
      px.set([...b.rgb, 255], (y * SIZE + x) * 4);
    }
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.rgba');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, px);
console.log(`wrote ${out} (${px.length} bytes)`);
