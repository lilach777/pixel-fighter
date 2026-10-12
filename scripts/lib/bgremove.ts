import { PNG } from 'pngjs';

/**
 * Controlled removal of a baked-in checkerboard background.
 *
 * The uploaded sheets are fully opaque RGBA with a noisy light-grey checkerboard
 * painted into the pixels. Several characters contain light-grey or white areas
 * (Koala fur, Migo wool, Rick's beard) that match the checker colours, so a global
 * colour key would destroy them. Instead:
 *
 *  1. Estimate the background luma range from the sheet border.
 *  2. Flood-fill from the border through "background-like" pixels only
 *     (low chroma, luma inside the estimated range), restricted to regions at least
 *     5px wide so the fill cannot squeeze through small gaps in an outline; then regrow
 *     a few pixels back up to the outline, and remove neutral drop shadows.
 *     Enclosed light areas inside a character are never reached.
 *  3. Enclosed pockets (e.g. the gap between an arm and the torso) are only removed
 *     when their tones are bimodal at the sheet's two measured checker tones.
 *     Light-grey fur / white wool is unimodal and fails this test.
 *  4. Defringe: light, low-chroma pixels touching removed background (anti-aliased
 *     halo / soft drop-shadow) are removed; mid-grey shadow pixels become
 *     semi-transparent black so outlines keep their anti-aliasing.
 */
export interface BgStats {
  lo: number;
  hi: number;
  maxChroma: number;
}

export interface BgRemovalReport {
  stats: BgStats;
  checkerTones: [number, number];
  floodRemoved: number;
  pocketsRemoved: number;
  pocketsKept: number;
  fringeRemoved: number;
  fringeSoftened: number;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const chroma = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

/** Two-means clustering of border luma: the checker's dark and light tones. */
export function checkerTones(png: PNG): [number, number] {
  const { width: w, height: h, data } = png;
  const Ls: number[] = [];
  for (let x = 0; x < w; x++) {
    for (const y of [0, 1, 2, h - 3, h - 2, h - 1]) {
      const i = (y * w + x) * 4;
      Ls.push(luma(data[i], data[i + 1], data[i + 2]));
    }
  }
  let a = Math.min(...Ls);
  let b = Math.max(...Ls);
  for (let it = 0; it < 20; it++) {
    let sa = 0;
    let na = 0;
    let sb = 0;
    let nb = 0;
    for (const l of Ls) {
      if (Math.abs(l - a) <= Math.abs(l - b)) {
        sa += l;
        na++;
      } else {
        sb += l;
        nb++;
      }
    }
    a = na ? sa / na : a;
    b = nb ? sb / nb : b;
  }
  return [Math.min(a, b), Math.max(a, b)];
}

export function estimateBackground(png: PNG): BgStats {
  const Ls: number[] = [];
  const Cs: number[] = [];
  const { width: w, height: h, data } = png;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    Ls.push(luma(data[i], data[i + 1], data[i + 2]));
    Cs.push(chroma(data[i], data[i + 1], data[i + 2]));
  };
  for (let x = 0; x < w; x++) for (const y of [0, 1, 2, h - 3, h - 2, h - 1]) sample(x, y);
  for (let y = 0; y < h; y++) for (const x of [0, 1, 2, w - 3, w - 2, w - 1]) sample(x, y);
  Ls.sort((a, b) => a - b);
  Cs.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    lo: Math.max(120, q(Ls, 0.02) - 18),
    hi: Math.min(250, q(Ls, 0.995) + 6),
    maxChroma: Math.max(14, q(Cs, 0.98) + 6),
  };
}

export function erodeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run = mask[y * w + x] ? run + 1 : 0;
      if (run >= k) tmp[y * w + x - r] = 1;
    }
    // Keep border pixels eligible so the fill can start at the image edge.
    for (let x = 0; x < r; x++) {
      tmp[y * w + x] = mask[y * w + x];
      tmp[y * w + w - 1 - x] = mask[y * w + w - 1 - x];
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      run = tmp[y * w + x] ? run + 1 : 0;
      if (run >= k) out[(y - r) * w + x] = 1;
    }
    for (let y = 0; y < r; y++) {
      out[y * w + x] = tmp[y * w + x];
      out[(h - 1 - y) * w + x] = tmp[(h - 1 - y) * w + x];
    }
  }
  return out;
}

/** What a region's outer boundary pixels are made of. */
export function boundaryStats(comp: number[], L: Float32Array, C: Float32Array, d: Uint8Array | Buffer, w: number, h: number, hi: number): { edgeBright: number; edgeDark: number; edgeFire: number } {
  const inSet = new Set(comp);
  const seen = new Set<number>();
  let bright = 0;
  let dark = 0;
  let fire = 0;
  for (const p of comp) {
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || inSet.has(q) || seen.has(q)) continue;
      seen.add(q);
      const i = q * 4;
      if (L[q] > hi && C[q] < 30) bright++;
      else if (L[q] < 80) dark++;
      else if (C[q] > 90 && d[i] > 180 && d[i] >= d[i + 1]) fire++;
    }
  }
  const n = Math.max(1, seen.size);
  return { edgeBright: +(bright / n).toFixed(2), edgeDark: +(dark / n).toFixed(2), edgeFire: +(fire / n).toFixed(2) };
}

/**
 * Checker periodicity: the most negative normalised autocorrelation of luma inside the
 * region at lags 3..14 px (horizontal and vertical, averaged). A checkerboard flips tone
 * every cell, so it is strongly anti-correlated at a lag of one cell (strongly negative
 * value); smoothly shaded fur / wool has no periodic structure (near zero or positive).
 */
export function checkerPeriodicity(comp: number[], L: Float32Array, w: number): number {
  const inSet = new Set(comp);
  let mean = 0;
  for (const p of comp) mean += L[p];
  mean /= comp.length;
  let varSum = 0;
  for (const p of comp) varSum += (L[p] - mean) ** 2;
  const variance = varSum / comp.length;
  if (variance < 1) return 0;
  let best = 1;
  for (let lag = 3; lag <= 14; lag++) {
    let ch = 0;
    let nh = 0;
    let cv = 0;
    let nv = 0;
    for (const p of comp) {
      const x = p % w;
      if (x + lag < w && inSet.has(p + lag)) {
        ch += (L[p] - mean) * (L[p + lag] - mean);
        nh++;
      }
      if (inSet.has(p + lag * w)) {
        cv += (L[p] - mean) * (L[p + lag * w] - mean);
        nv++;
      }
    }
    if (nh < 20 || nv < 20) continue;
    const corr = (ch / nh + cv / nv) / 2 / variance;
    if (corr < best) best = corr;
  }
  return best;
}

/** Mean length of horizontal runs of the same tone (above/below `split` luma) in a region. */
export function meanToneRun(comp: number[], L: Float32Array, split: number): number {
  const sorted = [...comp].sort((a, b) => a - b);
  let runs = 0;
  let sum = 0;
  let len = 0;
  let prev = -2;
  let tone = -1;
  for (const q of sorted) {
    const t = L[q] < split ? 0 : 1;
    if (q === prev + 1 && t === tone) len++;
    else {
      if (len) {
        runs++;
        sum += len;
      }
      len = 1;
      tone = t;
    }
    prev = q;
  }
  if (len) {
    runs++;
    sum += len;
  }
  return runs ? sum / runs : 0;
}

export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

export interface PocketInfo {
  /** 0 = neutral-checker pass, 1 = glow-tinted pass. A region can be reported by both. */
  pass: 0 | 1;
  removed: boolean;
  total: number;
  box: [number, number, number, number];
  meanC: number;
  midFrac: number;
  darkFrac: number;
  lightFrac: number;
  run: number;
  period: number;
  /** Fractions of the pocket's outer boundary that are near-white, dark outline, or saturated fire. */
  edgeBright: number;
  edgeDark: number;
  edgeFire: number;
}

export function removeBackground(src: PNG, onPocket?: (info: PocketInfo) => void): { out: PNG; report: BgRemovalReport } {
  const { width: w, height: h } = src;
  const d = src.data;
  const stats = estimateBackground(src);
  const n = w * h;
  const L = new Float32Array(n);
  const C = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    L[p] = luma(d[i], d[i + 1], d[i + 2]);
    C[p] = chroma(d[i], d[i + 1], d[i + 2]);
  }
  const [darkTone, lightTone] = checkerTones(src);
  const toneTol = Math.max(6, (lightTone - darkTone) / 4);
  // Near fire effects the painted checker carries a warm glow tint (chroma 15-25),
  // so the flood allows up to 30. Skin, denim, khaki and flame cores are all 60+.
  const floodChroma = Math.max(stats.maxChroma, 30);
  const bgLike = (p: number) => C[p] <= floodChroma && L[p] >= stats.lo && L[p] <= stats.hi;
  // Shadows under the feet are darker than the checker but still neutral; the fill may pass
  // through them only when entered from confirmed background (handled by the lower bound).
  const shadowLike = (p: number) => C[p] <= stats.maxChroma + 4 && L[p] >= stats.lo - 45 && L[p] <= stats.hi;

  // Stage A: flood from the border, but only through background that is at least
  // (2*NECK+1) px wide, so 1-2px gaps in a character outline cannot be crossed.
  const NECK = 2;
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p++) cand[p] = bgLike(p) ? 1 : 0;
  const wide = erodeMask(cand, w, h, NECK);
  const bg = new Uint8Array(n); // 1 = background
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }
  let floodRemoved = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (bg[p] || !wide[p]) continue;
    bg[p] = 1;
    floodRemoved++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // Stage B: limited geodesic regrowth (NECK+1 steps) back into the background-like
  // pixels next to outlines that the erosion skipped.
  let frontier: number[] = [];
  for (let p = 0; p < n; p++) if (bg[p]) frontier.push(p);
  for (let step = 0; step <= NECK; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !bg[q] && cand[q]) {
          bg[q] = 1;
          floodRemoved++;
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  // Stage C: soft drop shadows (neutral, darker than the checker). Grows only from
  // background into shadow pixels and never continues into light background-like pixels.
  for (let p = 0; p < n; p++) if (bg[p]) stack.push(p);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !bg[q] && shadowLike(q) && !cand[q]) {
        bg[q] = 1;
        floodRemoved++;
        stack.push(q);
      }
    }
  }

  // Stage D: painted glow halos. Around fire effects the generator painted a soft warm
  // glow over the checker; those pixels are warm, low-chroma and light. Remove a band of at
  // most GLOW_DEPTH px of them next to background. Saturated flame (chroma > 50) and the
  // white-hot core (luma >= 246) are never touched.
  const GLOW_DEPTH = 5;
  const glowLike = (p: number) => {
    const i = p * 4;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    return C[p] > stats.maxChroma && C[p] <= 50 && L[p] >= stats.lo - 10 && L[p] < 246 && r >= g && g >= b - 4;
  };
  frontier = [];
  for (let p = 0; p < n; p++) if (bg[p]) frontier.push(p);
  for (let step = 0; step < GLOW_DEPTH; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !bg[q] && glowLike(q)) {
          bg[q] = 1;
          floodRemoved++;
          next.push(q);
        }
      }
    }
    frontier = next;
  }

  // Stage E: checker trapped between a fist and its fire arc, sprinkled with spark specks.
  // Specks break the wide-corridor rule, so flood (without the neck restriction) through
  // tinted glow pixels anywhere, and through neutral checker pixels only within 8px of
  // saturated fire. Neutral fur/wool far from fire is never entered.
  const fire = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (C[p] > 90 && d[i] > 180 && d[i] >= d[i + 1] && d[i + 1] >= d[i + 2] - 4) fire[p] = 1;
  }
  const nearFire = dilateMask(fire, w, h, 8);
  const tinted = (p: number) => {
    const i = p * 4;
    return C[p] >= 12 && C[p] <= 50 && L[p] >= stats.lo - 10 && L[p] < 246 && d[i] >= d[i + 1] && d[i + 1] >= d[i + 2] - 4;
  };
  for (let p = 0; p < n; p++) if (bg[p]) stack.push(p);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !bg[q] && nearFire[q] && (tinted(q) || cand[q])) {
        bg[q] = 1;
        floodRemoved++;
        stack.push(q);
      }
    }
  }

  // Enclosed pockets of background-like pixels not reached by the flood fill, in two
  // passes. Pass 0 (neutral checker) uses exactly the original candidate set and rule.
  // Pass 1 then looks only at what is left for glow-tinted checker: checker trapped inside
  // a fire ring is painted over with an orange glow (measured mean chroma 15-27).
  const pocketLike = (p: number) => {
    if (L[p] < stats.lo || L[p] > stats.hi) return false;
    if (C[p] <= floodChroma) return true;
    const i = p * 4;
    return C[p] <= 45 && d[i] >= d[i + 1] && d[i + 1] >= d[i + 2] - 4;
  };
  let pocketsRemoved = 0;
  let pocketsKept = 0;
  for (const pass of [0, 1] as const) {
  const candidate = pass === 0 ? bgLike : pocketLike;
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (bg[start] || seen[start] || !candidate(start)) continue;
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && !seen[q] && !bg[q] && candidate(q)) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (comp.length < 12) continue; // specks: leave to defringe
    // Tone test: checkerboard pockets are bimodal at the sheet's two checker tones.
    // Light-grey fur / wool is unimodal and sits between (or outside) those tones.
    let sumC = 0;
    let nDark = 0;
    let nLight = 0;
    let nMid = 0;
    for (const p of comp) {
      sumC += C[p];
      if (Math.abs(L[p] - darkTone) <= toneTol) nDark++;
      else if (Math.abs(L[p] - lightTone) <= toneTol) nLight++;
      else nMid++;
    }
    const total = comp.length;
    const meanC = sumC / total;
    const midFrac = nMid / total;
    const bimodal = nDark / total >= 0.15 && nLight / total >= 0.15;
    // Spatial test: checker tone flips every 4-11 px, so same-tone horizontal runs are
    // short. Shaded fur forms broad same-tone patches (measured: Koala heads 6.8-8.4 px,
    // checker pockets 2-6 px).
    const run = meanToneRun(comp, L, (darkTone + lightTone) / 2);
    const maxRun = total > 1500 ? 6 : 6.5;
    const edgeStats = boundaryStats(comp, L, C, d, w, h, stats.hi);
    const checkerTexture = bimodal && midFrac < 0.5 && run <= maxRun;
    // Pass 0 (unchanged original rule): neutral pockets with checker texture.
    // Pass 1: glow-tinted pockets with checker texture that are NOT bordered by near-white
    // (shaded white wool sits inside pure white: edge brightness 0.23-0.47 vs tinted checker
    // <= 0.09), not mostly enclosed by dark outline (Migo chest 0.46 vs checker <= 0.37),
    // and with a real checker rhythm: anti-correlated at one cell (periodicity <= -0.08)
    // and runs >= 2.5 px. Grey beard/hair noise has periodicity >= -0.01 and runs <= 2.3.
    const tintedChecker = () => run >= 2.5 && checkerPeriodicity(comp, L, w) <= -0.08;
    const looksChecker =
      pass === 0
        ? meanC <= 14 && (total >= 120 ? checkerTexture : midFrac < 0.3)
        : total >= 120 && meanC > 14 && meanC <= 30 && checkerTexture && edgeStats.edgeBright <= 0.15 && edgeStats.edgeDark <= 0.4 && tintedChecker();
    if (onPocket && total >= 60) {
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (const q of comp) {
        const qx = q % w, qy = (q - qx) / w;
        if (qx < x0) x0 = qx;
        if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy;
        if (qy > y1) y1 = qy;
      }
      onPocket({ pass, removed: looksChecker, total, box: [x0, y0, x1, y1], meanC: +meanC.toFixed(1), midFrac: +midFrac.toFixed(2), darkFrac: +(nDark / total).toFixed(2), lightFrac: +(nLight / total).toFixed(2), run: +run.toFixed(1), period: +checkerPeriodicity(comp, L, w).toFixed(2), ...edgeStats });
    }
    if (looksChecker) {
      for (const p of comp) bg[p] = 1;
      pocketsRemoved++;
    } else if (pass === 0) {
      pocketsKept++;
    }
  }
  }

  // Defringe: up to two passes over pixels touching background.
  let fringeRemoved = 0;
  let fringeSoftened = 0;
  const alpha = new Uint8Array(n).fill(255);
  for (let p = 0; p < n; p++) if (bg[p]) alpha[p] = 0;
  for (let pass = 0; pass < 2; pass++) {
    const toClear: number[] = [];
    for (let p = 0; p < n; p++) {
      if (alpha[p] === 0) continue;
      const x = p % w;
      const y = (p - x) / w;
      const touches =
        (x > 0 && alpha[p - 1] === 0) ||
        (x < w - 1 && alpha[p + 1] === 0) ||
        (y > 0 && alpha[p - w] === 0) ||
        (y < h - 1 && alpha[p + w] === 0);
      if (!touches) continue;
      if (C[p] <= stats.maxChroma + 6 && L[p] >= stats.lo - 10) toClear.push(p);
    }
    for (const p of toClear) alpha[p] = 0;
    fringeRemoved += toClear.length;
  }
  // Soften remaining neutral mid-grey edge pixels (anti-aliased outline blended into the checker).
  const out = new PNG({ width: w, height: h });
  const bgMid = (stats.lo + stats.hi) / 2;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    out.data[i] = d[i];
    out.data[i + 1] = d[i + 1];
    out.data[i + 2] = d[i + 2];
    out.data[i + 3] = alpha[p];
    if (alpha[p] === 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    const touches =
      (x > 0 && alpha[p - 1] === 0) ||
      (x < w - 1 && alpha[p + 1] === 0) ||
      (y > 0 && alpha[p - w] === 0) ||
      (y < h - 1 && alpha[p + w] === 0);
    if (touches && C[p] <= stats.maxChroma + 6 && L[p] > 70) {
      // Treat as black composited over the background: a = 1 - L/bg.
      const a = Math.max(0, Math.min(1, 1 - L[p] / bgMid));
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = Math.round(a * 255);
      fringeSoftened++;
    }
  }
  return { out, report: { stats, checkerTones: [Math.round(darkTone), Math.round(lightTone)], floodRemoved, pocketsRemoved, pocketsKept, fringeRemoved, fringeSoftened } };
}
