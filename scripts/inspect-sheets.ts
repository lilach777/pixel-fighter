/**
 * Sprite-sheet inspection: reports dimensions, alpha usage and the dominant
 * background colours so we can tell real transparency from a baked-in checkerboard.
 * Usage: npm run assets:inspect
 */
import path from 'node:path';
import { findSourceSheets, readPng, px } from './lib/sheets';

const sheets = findSourceSheets();
for (const { id, file } of sheets) {
  if (!file) {
    console.log(`${id.padEnd(16)} MISSING`);
    continue;
  }
  const png = readPng(file);
  const alphaHist = new Map<number, number>();
  const colorHist = new Map<string, number>();
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const [r, g, b, a] = px(png, x, y);
      alphaHist.set(a, (alphaHist.get(a) ?? 0) + 1);
      const key = `${r},${g},${b}`;
      colorHist.set(key, (colorHist.get(key) ?? 0) + 1);
    }
  }
  const total = png.width * png.height;
  const opaque = alphaHist.get(255) ?? 0;
  const transparent = alphaHist.get(0) ?? 0;
  const top = [...colorHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  // Sample the top-left corner to estimate the checker cell size.
  let cell = 0;
  const [r0, g0, b0] = px(png, 0, 0);
  for (let x = 1; x < 64; x++) {
    const [r, g, b] = px(png, x, 0);
    if (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) > 12) {
      cell = x;
      break;
    }
  }
  console.log(
    `${id.padEnd(16)} ${path.basename(file).padEnd(36)} ${png.width}x${png.height} ` +
      `opaque=${((opaque / total) * 100).toFixed(1)}% transparent=${((transparent / total) * 100).toFixed(1)}% ` +
      `checkerCell≈${cell}px top=${top.map(([c, n]) => `${c}(${((n / total) * 100).toFixed(1)}%)`).join(' ')}`,
  );
}
