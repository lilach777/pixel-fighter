import type { PNG } from 'pngjs';

export interface Box {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number; // inclusive
}

export interface SlicedFrame extends Box {
  index: number;
  row: number;
  col: number;
  /** The body core (eroded silhouette) used for ground alignment. */
  body: Box;
  /** Feet anchor in sheet coordinates. */
  anchorX: number;
  anchorY: number;
}

export interface SliceOptions {
  alphaThreshold: number;
  /** Erosion radius used to find body cores; strips thin sparks / particle bridges. */
  erode: number;
  /** Minimum eroded area for a core to count as a character body. */
  minCoreArea: number;
  minCoreHeight: number;
  /** Cores whose bottoms differ by more than this start a new row. */
  rowGap: number;
  /** Stray parts farther than this from any frame are dropped as noise. */
  maxAttachDistance: number;
  /** Manual, documented cut points [sheetX, sheetY] for figures automation cannot separate. */
  cuts?: [number, number][];
  /** Manual points [sheetX, sheetY]: the group containing the point is merged into its left neighbour. */
  mergeLeft?: [number, number][];
}

export const DEFAULT_SLICE: SliceOptions = {
  alphaThreshold: 60,
  erode: 4,
  minCoreArea: 900,
  minCoreHeight: 45,
  rowGap: 70,
  maxAttachDistance: 60,
};

interface Comp extends Box {
  id: number;
  area: number;
  pixels: number[];
}

function components(w: number, h: number, on: (p: number) => boolean): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1 || !on(start)) continue;
    const c: Comp = { id: comps.length, area: 0, x0: w, y0: h, x1: 0, y1: 0, pixels: [] };
    labels[start] = c.id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.pixels.push(p);
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (labels[q] === -1 && on(q)) {
            labels[q] = c.id;
            stack.push(q);
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable square erosion.
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run = mask[y * w + x] ? run + 1 : 0;
      if (run >= 2 * r + 1) tmp[y * w + x - r] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      run = tmp[y * w + x] ? run + 1 : 0;
      if (run >= 2 * r + 1) out[(y - r) * w + x] = 1;
    }
  }
  return out;
}

const boxDistance = (a: Box, b: Box) => {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return Math.hypot(dx, dy);
};

/**
 * Slices a cleaned sheet into frames without assuming a grid.
 *  - Body cores: connected components of the eroded alpha mask (thin sparks and
 *    particle trails that bridge neighbouring figures disappear under erosion).
 *  - Rows: cores clustered by their foot line (bottom y).
 *  - Cores of one figure that overlap horizontally (e.g. a bat separated from the hands)
 *    are merged.
 *  - Every opaque pixel is then owned by exactly one frame: whole components touching a
 *    single frame's core go to it; bridged components are split per pixel by nearest core;
 *    detached parts (stars, "?" marks, dust, projectile tips) go to the nearest frame in
 *    the same row band.
 */
export function sliceFrames(png: PNG, opts: SliceOptions = DEFAULT_SLICE): { frames: SlicedFrame[]; owner: Int32Array } {
  const { width: w, height: h, data } = png;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = data[p * 4 + 3] >= opts.alphaThreshold ? 1 : 0;
  const core = erode(mask, w, h, opts.erode);
  const coreCC = components(w, h, (p) => core[p] === 1);
  let cores = coreCC.comps.filter((c) => c.area >= opts.minCoreArea && c.y1 - c.y0 + 1 >= opts.minCoreHeight);
  // A core spanning two sheet rows (an arc touching the figure above) is split at its
  // narrowest scanline between 35% and 75% of its height.
  const typical = median(cores.map((c) => c.y1 - c.y0));
  cores = cores.flatMap((c) => {
    if (c.y1 - c.y0 <= typical * 1.4) return [c];
    const rowsCount = new Map<number, number>();
    for (const p of c.pixels) {
      const y = Math.floor(p / w);
      rowsCount.set(y, (rowsCount.get(y) ?? 0) + 1);
    }
    let cutY = -1;
    let minCount = Infinity;
    for (let y = Math.round(c.y0 + (c.y1 - c.y0) * 0.35); y <= c.y0 + (c.y1 - c.y0) * 0.75; y++) {
      const k = rowsCount.get(y) ?? 0;
      if (k < minCount) {
        minCount = k;
        cutY = y;
      }
    }
    const top = compFrom(c.pixels.filter((p) => Math.floor(p / w) < cutY), w);
    const bottom = compFrom(c.pixels.filter((p) => Math.floor(p / w) >= cutY), w);
    return [top, bottom].filter((k) => k.area >= opts.minCoreArea);
  });

  // Rows by foot line.
  cores.sort((a, b) => a.y1 - b.y1);
  const rows: Comp[][] = [];
  for (const c of cores) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(c.y1 - median(row.map((r) => r.y1))) <= opts.rowGap) row.push(c);
    else rows.push([c]);
  }

  const standingHeight = median(cores.map((c) => c.y1 - c.y0));
  type Group = { row: number; col: number; cores: Comp[]; box: Box };
  const groups: Group[] = [];
  rows.forEach((row, ri) => {
    row.sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2);
    const merged: Comp[][] = [];
    for (const c of row) {
      const last = merged[merged.length - 1];
      if (last) {
        const lx0 = Math.min(...last.map((k) => k.x0));
        const lx1 = Math.max(...last.map((k) => k.x1));
        const overlap = Math.min(lx1, c.x1) - Math.max(lx0, c.x0);
        const narrow = Math.min(lx1 - lx0, c.x1 - c.x0);
        // Same figure if the horizontal overlap is large relative to the smaller core.
        if (overlap > narrow * 0.6) {
          last.push(c);
          continue;
        }
      }
      merged.push([c]);
    }
    // Lying-down figures (knockdown frames) are short; never valley-split those.
    let split = merged.flatMap((cs) => {
      const hgt = Math.max(...cs.map((c) => c.y1)) - Math.min(...cs.map((c) => c.y0));
      return hgt < standingHeight * 0.75 ? [cs] : splitAtHeadValley(cs, w);
    });
    // Manual cuts (sheet x, y): split the group whose box contains the point at x.
    for (const [cx, cy] of opts.cuts ?? []) {
      split = split.flatMap((cs) => {
        const bx0 = Math.min(...cs.map((c) => c.x0));
        const bx1 = Math.max(...cs.map((c) => c.x1));
        const by0 = Math.min(...cs.map((c) => c.y0));
        const by1 = Math.max(...cs.map((c) => c.y1));
        if (cx <= bx0 || cx >= bx1 || cy < by0 || cy > by1) return [cs];
        const pix = cs.flatMap((c) => c.pixels);
        return [[compFrom(pix.filter((p) => p % w < cx), w)], [compFrom(pix.filter((p) => p % w >= cx), w)]];
      });
    }
    split.forEach((cs, ci) =>
      groups.push({
        row: ri,
        col: ci,
        cores: cs,
        box: {
          x0: Math.min(...cs.map((c) => c.x0)),
          y0: Math.min(...cs.map((c) => c.y0)),
          x1: Math.max(...cs.map((c) => c.x1)),
          y1: Math.max(...cs.map((c) => c.y1)),
        },
      }),
    );
  });

  // Effect-only groups (detached fire crescents / blasts) are merged into the figure on
  // their left: every figure on these sheets faces right, so projections extend right.
  // Characters always contain heavy black outlines and dark clothing; effects almost none.
  // Resolve manual merges against the original boxes (so merges never cascade).
  const manualMerge = new Set(
    groups.filter((g) =>
      (opts.mergeLeft ?? []).some(([mx, my]) => mx >= g.box.x0 && mx <= g.box.x1 && my >= g.box.y0 && my <= g.box.y1),
    ),
  );
  const isDark = (p: number) => 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2] < 55;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    let dark = 0;
    let n = 0;
    for (const c of g.cores) {
      for (const p of c.pixels) {
        n++;
        if (isDark(p)) dark++;
      }
    }
    const manual = manualMerge.has(g);
    if (!manual && (n === 0 || dark / n >= 0.03)) continue;
    const sameRow = groups.filter((o) => o !== g && o.row === g.row);
    const leftN = sameRow.filter((o) => o.box.x1 <= g.box.x0 + 20).sort((a, b) => b.box.x1 - a.box.x1)[0];
    const rightN = sameRow.filter((o) => o.box.x0 >= g.box.x1 - 20).sort((a, b) => a.box.x0 - b.box.x0)[0];
    const target = leftN && g.box.x0 - leftN.box.x1 < 90 ? leftN : rightN;
    if (!target) continue;
    target.cores.push(...g.cores);
    target.box = {
      x0: Math.min(target.box.x0, g.box.x0),
      y0: Math.min(target.box.y0, g.box.y0),
      x1: Math.max(target.box.x1, g.box.x1),
      y1: Math.max(target.box.y1, g.box.y1),
    };
    groups.splice(gi, 1);
  }
  // Re-number columns after merges.
  for (let ri = 0; ri < rows.length; ri++) {
    groups
      .filter((g) => g.row === ri)
      .sort((a, b) => a.box.x0 - b.box.x0)
      .forEach((g, ci) => (g.col = ci));
  }
  groups.sort((a, b) => a.row - b.row || a.col - b.col);

  const coreOwner = new Int32Array(w * h).fill(-1);
  groups.forEach((g, gi) => {
    for (const c of g.cores) for (const p of c.pixels) coreOwner[p] = gi;
  });

  const owner = new Int32Array(w * h).fill(-1);
  const full = components(w, h, (p) => mask[p] === 1);
  const rowBand = rows.map((_, ri) => {
    const gs = groups.filter((g) => g.row === ri);
    return { y0: Math.min(...gs.map((g) => g.box.y0)) - 45, y1: Math.max(...gs.map((g) => g.box.y1)) + 6 };
  });
  for (const comp of full.comps) {
    const touching = new Set<number>();
    for (const p of comp.pixels) if (coreOwner[p] !== -1) touching.add(coreOwner[p]);
    if (touching.size === 1) {
      const gi = [...touching][0];
      for (const p of comp.pixels) owner[p] = gi;
    } else if (touching.size > 1) {
      // Bridged figures: split per pixel by horizontal distance to each core box,
      // tie-broken by full distance.
      const cand = [...touching];
      for (const p of comp.pixels) {
        const x = p % w;
        const y = (p - x) / w;
        let best = cand[0];
        let bestD = Infinity;
        for (const gi of cand) {
          const b = groups[gi].box;
          const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
          const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
          const cx = Math.abs(x - (b.x0 + b.x1) / 2) / 1000;
          const d = dx * 4 + dy + cx;
          if (d < bestD) {
            bestD = d;
            best = gi;
          }
        }
        owner[p] = best;
      }
    } else {
      if (comp.area < 4) continue;
      const cy = (comp.y0 + comp.y1) / 2;
      let best = -1;
      let bestD = Infinity;
      groups.forEach((g, gi) => {
        const band = rowBand[g.row];
        if (cy < band.y0 || cy > band.y1) return;
        const d = boxDistance(comp, g.box);
        if (d < bestD) {
          bestD = d;
          best = gi;
        }
      });
      if (best === -1 || bestD > opts.maxAttachDistance) continue;
      for (const p of comp.pixels) owner[p] = best;
    }
  }

  const frames: SlicedFrame[] = groups.map((g, gi) => ({
    index: gi,
    row: g.row,
    col: g.col,
    x0: w,
    y0: h,
    x1: 0,
    y1: 0,
    body: g.box,
    anchorX: 0,
    anchorY: 0,
  }));
  for (let p = 0; p < w * h; p++) {
    const gi = owner[p];
    if (gi === -1) continue;
    const f = frames[gi];
    const x = p % w;
    const y = (p - x) / w;
    if (x < f.x0) f.x0 = x;
    if (x > f.x1) f.x1 = x;
    if (y < f.y0) f.y0 = y;
    if (y > f.y1) f.y1 = y;
  }
  // Ground anchor: lowest owned body row (core bottom + erosion radius) and the centre
  // of owned pixels in the lowest 16px above it.
  for (const f of frames) {
    const foot = Math.min(f.y1, f.body.y1 + opts.erode);
    let sx = 0;
    let n = 0;
    for (let y = Math.max(f.y0, foot - 16); y <= foot; y++) {
      for (let x = f.body.x0 - opts.erode; x <= f.body.x1 + opts.erode; x++) {
        if (x < 0 || x >= w) continue;
        if (owner[y * w + x] === f.index) {
          sx += x;
          n++;
        }
      }
    }
    f.anchorX = n ? Math.round(sx / n) : Math.round((f.body.x0 + f.body.x1) / 2);
    f.anchorY = foot;
  }
  return { frames, owner };
}

/**
 * Two figures can stay connected even after erosion (a chainsaw or flame touching the
 * next character). Heads/torsos are still separate, so look at the core pixels in the
 * upper 45% of the group and split at an empty column valley that has substantial mass
 * on both sides. Applied recursively.
 */
function splitAtHeadValley(cs: Comp[], w: number): Comp[][] {
  const pix = cs.flatMap((c) => c.pixels);
  const x0 = Math.min(...cs.map((c) => c.x0));
  const x1 = Math.max(...cs.map((c) => c.x1));
  const y0 = Math.min(...cs.map((c) => c.y0));
  const y1 = Math.max(...cs.map((c) => c.y1));
  const bandEnd = y0 + (y1 - y0) * 0.45;
  const legStart = y0 + (y1 - y0) * 0.75;
  const cols = new Array(x1 - x0 + 1).fill(0);
  const legCols = new Array(x1 - x0 + 1).fill(0);
  let total = 0;
  let legTotal = 0;
  for (const p of pix) {
    const x = p % w;
    const y = (p - x) / w;
    if (y <= bandEnd) {
      cols[x - x0]++;
      total++;
    }
    if (y >= legStart) {
      legCols[x - x0]++;
      legTotal++;
    }
  }
  const legLeftOf = (i: number) => legCols.slice(0, i).reduce((a, b) => a + b, 0);
  if (x1 - x0 < 120 || total === 0) return [cs];
  let best = -1;
  let bestScore = 0;
  let left = 0;
  for (let i = 0; i < cols.length; i++) {
    left += cols[i];
    if (cols[i] > 2) continue;
    // Require a gap at least 4 columns wide.
    let gap = 0;
    while (i + gap < cols.length && cols[i + gap] <= 2) gap++;
    const right = total - left;
    const minSide = Math.min(left, right) / total;
    // Both sides must also stand on legs (a swing arc beside a body has no legs).
    const legL = legLeftOf(i + Math.floor(gap / 2));
    const legMin = legTotal ? Math.min(legL, legTotal - legL) / legTotal : 0;
    if (gap >= 4 && minSide >= 0.3 && legMin >= 0.2 && i >= 50 && cols.length - i >= 50 && minSide > bestScore) {
      bestScore = minSide;
      best = i + Math.floor(gap / 2);
    }
  }
  if (best === -1) return [cs];
  const cut = x0 + best;
  const leftPix = pix.filter((p) => p % w < cut);
  const rightPix = pix.filter((p) => p % w >= cut);
  return [...splitAtHeadValley([compFrom(leftPix, w)], w), ...splitAtHeadValley([compFrom(rightPix, w)], w)];
}

function compFrom(pixels: number[], w: number): Comp {
  const c: Comp = { id: -1, area: pixels.length, pixels, x0: w, y0: Infinity, x1: 0, y1: 0 };
  for (const p of pixels) {
    const x = p % w;
    const y = (p - x) / w;
    c.x0 = Math.min(c.x0, x);
    c.x1 = Math.max(c.x1, x);
    c.y0 = Math.min(c.y0, y);
    c.y1 = Math.max(c.y1, y);
  }
  return c;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
