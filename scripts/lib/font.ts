import type { PNG } from 'pngjs';

// Minimal 3x5 bitmap font (digits, a few letters) for labelling preview images.
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  r: ['000', '110', '101', '100', '100'],
  c: ['000', '011', '100', '100', '011'],
  ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'],
};

export function drawText(png: PNG, text: string, x: number, y: number, scale: number, rgb: [number, number, number]): void {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (g[gy][gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cx + gx * scale + sx;
            const py = y + gy * scale + sy;
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
            const i = (py * png.width + px) * 4;
            png.data[i] = rgb[0];
            png.data[i + 1] = rgb[1];
            png.data[i + 2] = rgb[2];
            png.data[i + 3] = 255;
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

export function fillRect(png: PNG, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]): void {
  for (let yy = Math.max(0, y); yy < Math.min(png.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(png.width, x + w); xx++) {
      const i = (yy * png.width + xx) * 4;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
}

export function strokeRect(png: PNG, x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
  fillRect(png, x, y, w, 1, [...rgb, 255]);
  fillRect(png, x, y + h - 1, w, 1, [...rgb, 255]);
  fillRect(png, x, y, 1, h, [...rgb, 255]);
  fillRect(png, x + w - 1, y, 1, h, [...rgb, 255]);
}
