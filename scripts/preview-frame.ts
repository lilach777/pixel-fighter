/**
 * Frame verification tool. For each requested frame renders four panels side by side:
 *   1. original source crop (checkerboard visible)
 *   2. processed frame over magenta     (any leftover checker is obvious)
 *   3. processed frame over dark purple (in-game look)
 *   4. processed frame over white       (dark fringes / missing outline visible)
 * Usage: npx tsx scripts/preview-frame.ts <id> <frameKey...> [--scale 2]
 * Output: docs/asset-previews/frames/<id>-<key>.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { CHAR_DIR, METADATA_DIR, ROOT, findSourceSheets, readPng, writePng } from './lib/sheets';

const args = process.argv.slice(2);
const scaleIdx = args.indexOf('--scale');
const S = scaleIdx >= 0 ? Number(args[scaleIdx + 1]) : 2;
const [id, ...keys] = scaleIdx >= 0 ? args.filter((_, i) => i !== scaleIdx && i !== scaleIdx + 1) : args;

interface FrameMeta {
  key: string;
  src: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
}
const meta = JSON.parse(fs.readFileSync(path.join(METADATA_DIR, `${id}.json`), 'utf8')) as { atlas: string; frames: FrameMeta[] };
const atlas = readPng(path.join(CHAR_DIR, meta.atlas));
const source = readPng(findSourceSheets().find((s) => s.id === id)!.file!);
const outDir = path.join(ROOT, 'docs', 'asset-previews', 'frames');
fs.mkdirSync(outDir, { recursive: true });

const BGS: [number, number, number][] = [
  [255, 0, 255],
  [40, 18, 66],
  [255, 255, 255],
];

for (const key of keys.length ? keys : meta.frames.map((f) => f.key)) {
  const f = meta.frames.find((x) => x.key === key);
  if (!f) {
    console.error(`no frame ${key}`);
    continue;
  }
  const w = f.rect.w;
  const h = f.rect.h;
  const gap = 6;
  const out = new PNG({ width: (w * 4 + gap * 3) * S, height: h * S });
  out.data.fill(30);
  const put = (px: number, py: number, rgb: [number, number, number]) => {
    for (let dy = 0; dy < S; dy++)
      for (let dx = 0; dx < S; dx++) {
        const i = ((py * S + dy) * out.width + px * S + dx) * 4;
        out.data[i] = rgb[0];
        out.data[i + 1] = rgb[1];
        out.data[i + 2] = rgb[2];
        out.data[i + 3] = 255;
      }
  };
  // Panel 1: source crop aligned with the processed rect (rect has 2px padding around src).
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = f.src.x - 2 + x;
      const sy = f.src.y - 2 + y;
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const i = (sy * source.width + sx) * 4;
      put(x, y, [source.data[i], source.data[i + 1], source.data[i + 2]]);
    }
  BGS.forEach((bg, k) => {
    const ox = (k + 1) * (w + gap);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = ((f.rect.y + y) * atlas.width + f.rect.x + x) * 4;
        const a = atlas.data[i + 3] / 255;
        put(ox + x, y, [0, 1, 2].map((c) => Math.round(atlas.data[i + c] * a + bg[c] * (1 - a))) as [number, number, number]);
      }
  });
  const file = path.join(outDir, `${id}-${key}.png`);
  writePng(file, out);
  console.log(path.relative(ROOT, file));
}
