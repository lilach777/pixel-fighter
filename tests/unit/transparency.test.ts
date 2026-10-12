import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS } from '../../shared/src/characters/roster';
import { removeBackground, type PocketInfo } from '../../scripts/lib/bgremove';
import { findSourceSheets, readPng } from '../../scripts/lib/sheets';

const CHAR_DIR = path.resolve(import.meta.dirname, '..', '..', 'client', 'public', 'assets', 'characters');
interface Frame {
  key: string;
  src: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
}
const metaCache = new Map<string, { atlas: string; frames: Frame[] }>();
const atlasCache = new Map<string, PNG>();
const meta = (id: string) => {
  if (!metaCache.has(id)) metaCache.set(id, JSON.parse(fs.readFileSync(path.join(CHAR_DIR, 'metadata', `${id}.json`), 'utf8')));
  return metaCache.get(id)!;
};
const atlasOf = (id: string) => {
  if (!atlasCache.has(id)) atlasCache.set(id, PNG.sync.read(fs.readFileSync(path.join(CHAR_DIR, meta(id).atlas))));
  return atlasCache.get(id)!;
};

/** Alpha of the processed pixel that came from source-sheet pixel (sx, sy). */
function alphaAtSource(id: string, sx: number, sy: number): number {
  const m = meta(id);
  const f = m.frames.find((fr) => sx >= fr.src.x && sx < fr.src.x + fr.src.w && sy >= fr.src.y && sy < fr.src.y + fr.src.h);
  if (!f) return 0; // outside every frame: not drawn at all
  const a = atlasOf(id);
  const ax = f.rect.x + 2 + (sx - f.src.x);
  const ay = f.rect.y + 2 + (sy - f.src.y);
  return a.data[(ay * a.width + ax) * 4 + 3];
}

/** Light neutral pixels (checker-coloured) that are still opaque in a processed frame. */
function lightNeutral(id: string, key: string): number {
  const f = meta(id).frames.find((fr) => fr.key === key)!.rect;
  const a = atlasOf(id);
  let n = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = ((f.y + y) * a.width + f.x + x) * 4;
      const [r, g, b, al] = [a.data[i], a.data[i + 1], a.data[i + 2], a.data[i + 3]];
      if (al > 0 && (r + g + b) / 3 > 175 && Math.max(r, g, b) - Math.min(r, g, b) < 30) n++;
    }
  return n;
}

describe('source sheets: the checkerboard is baked into the pixels', () => {
  it.each(CHARACTER_IDS)('%s source is fully opaque (so PNG alone does not mean transparent)', (id) => {
    const src = readPng(findSourceSheets().find((s) => s.id === id)!.file!);
    let opaque = 0;
    for (let i = 3; i < src.data.length; i += 4) if (src.data[i] === 255) opaque++;
    expect(opaque).toBe(src.width * src.height);
  });
});

describe('background classifier on hand-verified ground truth', () => {
  // Pocket bounding-box top-left corners in source-sheet pixels. Each was verified by eye
  // (crops of the source): CHECKER = painted checkerboard, KEEP = character art.
  const truth: Record<string, { at: [number, number]; expect: 'remove' | 'keep'; what: string }[]> = {
    'max-sanchez': [
      { at: [1238, 588], expect: 'remove', what: 'checker inside flame ring, right of head (screenshot frame r3c5)' },
      { at: [1123, 598], expect: 'remove', what: 'checker inside flame ring, behind back (r3c5)' },
      { at: [1126, 678], expect: 'remove', what: 'checker between the legs (r3c5)' },
    ],
    jeremy: [{ at: [1212, 623], expect: 'remove', what: 'checker inside the bat flame' }],
    koala: [
      { at: [48, 210], expect: 'keep', what: 'grey fur head (r1c0)' },
      { at: [887, 211], expect: 'keep', what: 'grey fur head (r1c5)' },
      { at: [29, 767], expect: 'keep', what: 'grey fur head (crouch r4c0)' },
    ],
    migo: [
      { at: [616, 46], expect: 'keep', what: 'white wool forehead' },
      { at: [1118, 81], expect: 'keep', what: 'white wool face' },
      { at: [583, 271], expect: 'keep', what: 'white wool face' },
      { at: [1120, 120], expect: 'keep', what: 'chest' },
    ],
    rick: [
      { at: [319, 70], expect: 'keep', what: 'grey beard (r0c2)' },
      { at: [680, 945], expect: 'keep', what: 'grey beard (r5c4)' },
    ],
  };
  it.each(Object.keys(truth))('%s', (id) => {
    const src = readPng(findSourceSheets().find((s) => s.id === id)!.file!);
    const pockets: PocketInfo[] = [];
    removeBackground(src, (p) => pockets.push(p));
    for (const t of truth[id]) {
      // A region may be reported by both passes; it is removed if either pass removed it.
      const ps = pockets.filter((q) => Math.abs(q.box[0] - t.at[0]) <= 3 && Math.abs(q.box[1] - t.at[1]) <= 3);
      expect(ps.length, `${id}: pocket for ${t.what}`).toBeGreaterThan(0);
      expect(ps.some((q) => q.removed) ? 'remove' : 'keep', `${id}: ${t.what}`).toBe(t.expect);
    }
  }, 60_000);
});

describe('processed frames', () => {
  it('Max Sanchez flame-ring super frame (r3c5) is transparent inside the ring', () => {
    // Centres of the three checker pockets from the bug screenshot.
    // Every checker-coloured (low-chroma, light) source pixel in those regions must be
    // transparent; flame wisps crossing them (chroma 50-70) are art and may stay.
    const src = readPng(findSourceSheets().find((s) => s.id === 'max-sanchez')!.file!);
    for (const [x0, y0, x1, y1] of [
      [1238, 588, 1309, 631],
      [1123, 598, 1164, 638],
      [1126, 678, 1218, 710],
    ]) {
      let checker = 0;
      let left = 0;
      let isolated = 0;
      const isArt = (x: number, y: number) => {
        const i = (y * src.width + x) * 4;
        const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
        return !((r + g + b) / 3 > 170 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) && alphaAtSource('max-sanchez', x, y) > 0;
      };
      for (let sy = y0; sy <= y1; sy++)
        for (let sx = x0; sx <= x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
          const isChecker = (r + g + b) / 3 > 170 && Math.max(r, g, b) - Math.min(r, g, b) <= 30;
          if (!isChecker) continue;
          checker++;
          if (alphaAtSource('max-sanchez', sx, sy) === 0) continue;
          left++;
          // Allowed only as the anti-aliased fringe of real art (flame wisp) within 2 px.
          let nearArt = false;
          for (let dy = -2; dy <= 2 && !nearArt; dy++) for (let dx = -2; dx <= 2 && !nearArt; dx++) if (isArt(sx + dx, sy + dy)) nearArt = true;
          if (!nearArt) isolated++;
        }
      expect(checker).toBeGreaterThan(300);
      expect(left / checker, `checker left in ${x0},${y0}`).toBeLessThan(0.06);
      expect(isolated, `isolated checker pixels in ${x0},${y0}`).toBe(0);
    }
    // Before the fix 3755 checker-coloured pixels remained in this frame.
    expect(lightNeutral('max-sanchez', 'r3c5')).toBeLessThan(1000);
  });

  it('keeps important character pixels (outlines, fur, wool, beard) opaque', () => {
    const solid = (id: string, sx: number, sy: number) => {
      let opaque = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (alphaAtSource(id, sx + dx, sy + dy) > 0) opaque++;
      return opaque / 49;
    };
    expect(solid('koala', 91, 243)).toBeGreaterThan(0.95); // fur head
    expect(solid('migo', 1147, 93)).toBeGreaterThan(0.95); // wool face
    expect(solid('rick', 331, 79)).toBeGreaterThan(0.95); // beard
  });

  it('attack frames are cropped whole and in order (ring kept, neighbours separate)', () => {
    const m = meta('max-sanchez');
    const [c4, c5, c6] = ['r3c4', 'r3c5', 'r3c6'].map((k) => m.frames.find((f) => f.key === k)!);
    expect(c4.src.x).toBeLessThan(c5.src.x);
    expect(c5.src.x).toBeLessThan(c6.src.x);
    expect(c5.src.w).toBeGreaterThan(220); // the whole flame ring is part of the frame
    const a = atlasOf('max-sanchez');
    // Opaque pixels reach both horizontal ends of the frame (ring tips), so nothing is cut off.
    const colHasInk = (x: number) => {
      for (let y = 0; y < c5.rect.h; y++) if (a.data[((c5.rect.y + y) * a.width + c5.rect.x + x) * 4 + 3] > 0) return true;
      return false;
    };
    expect(colHasInk(3)).toBe(true);
    expect(colHasInk(c5.rect.w - 4)).toBe(true);
  });

  it.each(CHARACTER_IDS)('%s: every frame has a transparent border (no flattened background)', (id) => {
    const m = meta(id);
    const a = atlasOf(id);
    for (const f of m.frames) {
      // The 2px padding ring around each frame must be fully transparent.
      for (let x = 0; x < f.rect.w; x++)
        for (const y of [0, f.rect.h - 1]) expect(a.data[((f.rect.y + y) * a.width + f.rect.x + x) * 4 + 3], `${id} ${f.key}`).toBe(0);
    }
  });
});
