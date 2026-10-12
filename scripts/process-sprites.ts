/**
 * Sprite pipeline: source sheet -> background removal -> frame slicing -> per-frame crop
 * with transparent padding -> atlas packing -> metadata (frames, ground anchors, animations)
 * -> labelled previews for visual verification.
 *
 * Source images in assets/characters/source are never modified.
 * Usage: npm run assets:process [characterId...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { removeBackground } from './lib/bgremove';
import { sliceFrames, DEFAULT_SLICE, type SlicedFrame } from './lib/slice';
import { drawText, fillRect, strokeRect } from './lib/font';
import { findSourceSheets, readPng, writePng, METADATA_DIR, PROCESSED_DIR, ROOT, CHAR_DIR } from './lib/sheets';
import { resolveAnimations, type AnimationMapFile } from './lib/animmap';

const PAD = 2;
const ATLAS_MAX_W = 2048;

const only = process.argv.slice(2);
const mapFile = path.join(ROOT, 'scripts', 'animation-map.json');
const animMap: AnimationMapFile | null = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
const overrides: { cuts: Record<string, [number, number][]>; mergeLeft: Record<string, [number, number][]> } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts', 'slice-overrides.json'), 'utf8'),
);
const previewDir = path.join(ROOT, 'docs', 'asset-previews');
const cacheDir = path.join(ROOT, '.cache', 'clean');
fs.mkdirSync(previewDir, { recursive: true });
fs.mkdirSync(METADATA_DIR, { recursive: true });

const summary: Record<string, unknown>[] = [];
let failed = false;

for (const { id, file } of findSourceSheets()) {
  if (only.length && !only.includes(id)) continue;
  if (!file) {
    console.error(`[${id}] MISSING source sheet in ${path.relative(ROOT, path.dirname(METADATA_DIR))}/source`);
    failed = true;
    continue;
  }
  const src = readPng(file);
  const { out: clean, report } = removeBackground(src);
  writePng(path.join(cacheDir, `${id}.png`), clean);
  const cuts = overrides.cuts[id] ?? [];
  const { frames, owner } = sliceFrames(clean, { ...DEFAULT_SLICE, cuts, mergeLeft: overrides.mergeLeft[id] ?? [] });

  // Rows/cols summary
  const rows = new Map<number, number>();
  for (const f of frames) rows.set(f.row, (rows.get(f.row) ?? 0) + 1);

  // ---- Atlas packing (shelf) ----
  const sorted = [...frames].sort((a, b) => a.row - b.row || a.col - b.col);
  let cx = 0;
  let cy = 0;
  let shelfH = 0;
  let atlasW = 0;
  const placed = sorted.map((f) => {
    const w = f.x1 - f.x0 + 1 + PAD * 2;
    const h = f.y1 - f.y0 + 1 + PAD * 2;
    if (cx + w > ATLAS_MAX_W) {
      cx = 0;
      cy += shelfH;
      shelfH = 0;
    }
    const pos = { x: cx, y: cy, w, h };
    cx += w;
    shelfH = Math.max(shelfH, h);
    atlasW = Math.max(atlasW, cx);
    return { f, pos };
  });
  const atlasH = cy + shelfH;
  const atlas = new PNG({ width: atlasW, height: atlasH });
  atlas.data.fill(0);
  for (const { f, pos } of placed) blitFrame(clean, owner, f, atlas, pos.x + PAD, pos.y + PAD);
  const atlasRel = `processed/${id}.png`;
  writePng(path.join(CHAR_DIR, atlasRel), atlas);

  // Portraits: the front-facing idle frame (r0c0) and a head/shoulders bust crop,
  // so menus never need to download the full atlas.
  const front = placed.find(({ f }) => f.row === 0 && f.col === 0);
  if (front) {
    const fw = front.pos.w;
    const fh = front.pos.h;
    const portrait = new PNG({ width: fw, height: fh });
    portrait.data.fill(0);
    blitFrame(clean, owner, front.f, portrait, PAD, PAD);
    writePng(path.join(PROCESSED_DIR, 'portraits', `${id}.png`), portrait);
    const bh = Math.round(fh * 0.5);
    const bust = new PNG({ width: fw, height: bh });
    for (let y = 0; y < bh; y++) portrait.data.copy(bust.data, y * fw * 4, y * fw * 4, (y + 1) * fw * 4);
    writePng(path.join(PROCESSED_DIR, 'portraits', `${id}-bust.png`), bust);
  }

  const frameMeta = placed.map(({ f, pos }) => ({
    key: `r${f.row}c${f.col}`,
    row: f.row,
    col: f.col,
    src: { x: f.x0, y: f.y0, w: f.x1 - f.x0 + 1, h: f.y1 - f.y0 + 1 },
    rect: pos,
    // Anchor relative to the atlas rect's top-left corner: y = ground contact (feet),
    // x = trunk centre (stable across walk/run cycles and lunges; see trunkCenterX).
    anchor: { x: trunkCenterX(atlas, pos, f.anchorY - f.y0 + PAD, f.body.y1 - f.body.y0 + 1) ?? f.anchorX - f.x0 + PAD, y: f.anchorY - f.y0 + PAD },
    footAnchorX: f.anchorX - f.x0 + PAD,
    bodyHeight: f.body.y1 - f.body.y0 + 1,
  }));

  let animations: ReturnType<typeof resolveAnimations>['animations'] = {};
  let animIssues: string[] = [];
  if (animMap) {
    const res = resolveAnimations(animMap, id, new Set(frameMeta.map((f) => f.key)));
    animations = res.animations;
    animIssues = res.issues;
    if (animIssues.length) failed = true;
  }

  const meta = {
    id,
    source: `source/${path.basename(file)}`,
    sourceSize: { w: src.width, h: src.height },
    atlas: atlasRel,
    atlasSize: { w: atlasW, h: atlasH },
    background: {
      method: 'border-flood-fill + checker-texture pockets + defringe',
      bakedCheckerboard: true,
      ...report,
    },
    rows: Object.fromEntries([...rows.entries()].map(([r, n]) => [`r${r}`, n])),
    frames: frameMeta,
    animations,
  };
  fs.writeFileSync(path.join(METADATA_DIR, `${id}.json`), JSON.stringify(meta, null, 1));

  writePng(path.join(previewDir, `${id}-frames.png`), makePreview(clean, owner, frames));
  summary.push({ id, frames: frames.length, rows: Object.fromEntries(rows), pockets: report.pocketsRemoved, kept: report.pocketsKept, issues: animIssues.length });
  console.log(`[${id}] frames=${frames.length} rows=${[...rows.values()].join('/')} bg=${JSON.stringify(report.stats)} pocketsRemoved=${report.pocketsRemoved} pocketsKept=${report.pocketsKept}`);
  for (const issue of animIssues) console.error(`  ! ${issue}`);
}

fs.writeFileSync(path.join(METADATA_DIR, 'index.json'), JSON.stringify(summary, null, 1));
if (failed) {
  console.error('Sprite processing finished with problems (see above).');
  process.exitCode = 1;
}

/**
 * Horizontal centre of the trunk: within the 25-60% height band of the body, count opaque
 * "body" pixels per column (fire-effect and near-white pixels excluded), then take the
 * weighted centre of the columns whose count is >= 65% of the thickest column. Arms,
 * bats and flame arcs are thin in that band; the trunk is the thickest vertical mass.
 * Anchoring on the trunk (not the feet, whose spread changes every frame of a run cycle)
 * keeps the character's body planted between frames.
 */
function trunkCenterX(atlas: PNG, r: { x: number; y: number; w: number; h: number }, footY: number, bodyH: number): number | null {
  const top = footY - bodyH;
  const y0 = Math.max(0, Math.round(top + bodyH * 0.25));
  const y1 = Math.min(r.h - 1, Math.round(top + bodyH * 0.6));
  const cols = new Array(r.w).fill(0);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) * atlas.width + r.x + x) * 4;
      if (atlas.data[i + 3] < 128) continue;
      const R = atlas.data[i];
      const G = atlas.data[i + 1];
      const B = atlas.data[i + 2];
      const mx = Math.max(R, G, B);
      const chroma = mx - Math.min(R, G, B);
      if (R > 180 && chroma > 90 && R >= G && G >= B) continue; // flame
      if (mx > 235 && chroma < 40) continue; // white-hot core / sparks
      cols[x]++;
    }
  }
  const max = Math.max(...cols);
  if (max < 8) return null;
  let sx = 0;
  let n = 0;
  cols.forEach((c, x) => {
    if (c >= max * 0.65) {
      sx += x * c;
      n += c;
    }
  });
  return Math.round(sx / n);
}

function blitFrame(src: PNG, owner: Int32Array, f: SlicedFrame, dst: PNG, dx: number, dy: number) {
  for (let y = f.y0; y <= f.y1; y++) {
    for (let x = f.x0; x <= f.x1; x++) {
      const si = (y * src.width + x) * 4;
      if (src.data[si + 3] === 0) continue;
      // Only pixels owned by this frame. Soft fringe pixels below the slicing threshold
      // have no owner; keep them unless they are inside another frame's core box.
      const o = owner[y * src.width + x];
      if (o !== f.index && (o !== -1 || src.data[si + 3] >= 60)) continue;
      const di = ((dy + y - f.y0) * dst.width + (dx + x - f.x0)) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

/** Cleaned sheet over a dark-purple background with frame boxes, anchors and r:c labels. */
function makePreview(clean: PNG, owner: Int32Array, frames: SlicedFrame[]): PNG {
  const p = new PNG({ width: clean.width, height: clean.height });
  for (let i = 0; i < clean.data.length; i += 4) {
    const a = clean.data[i + 3] / 255;
    // Background alternates per owning frame so ownership splits are visible.
    const o = owner[i / 4];
    const bg = o >= 0 && o % 2 ? [20, 45, 70] : [45, 22, 66];
    p.data[i] = Math.round(clean.data[i] * a + bg[0] * (1 - a));
    p.data[i + 1] = Math.round(clean.data[i + 1] * a + bg[1] * (1 - a));
    p.data[i + 2] = Math.round(clean.data[i + 2] * a + bg[2] * (1 - a));
    p.data[i + 3] = 255;
  }
  for (const f of frames) {
    strokeRect(p, f.x0, f.y0, f.x1 - f.x0 + 1, f.y1 - f.y0 + 1, [0, 255, 200]);
    fillRect(p, f.anchorX - 3, f.anchorY - 1, 7, 3, [255, 0, 80, 255]);
    fillRect(p, f.x0, f.y0, 36, 14, [0, 0, 0, 255]);
    drawText(p, `${f.row}:${f.col}`, f.x0 + 2, f.y0 + 2, 2, [255, 255, 0]);
  }
  return p;
}
