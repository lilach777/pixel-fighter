import { ARENA_HEIGHT, ARENA_WIDTH, GROUND_Y } from '../../../../shared/src/constants';
import { Rng } from '../../../../shared/src/rng';

export interface StageDef {
  id: string;
  name: string;
  description: string;
  preview: [string, string];
}

export const STAGES: StageDef[] = [
  { id: 'rooftop', name: 'Neon Rooftop', description: 'Midnight skyline above the city.', preview: ['#2b1050', '#ff7a1a'] },
  { id: 'arcade', name: 'Arcade Floor', description: 'Rows of humming cabinets.', preview: ['#140a2a', '#b44dff'] },
  { id: 'vault', name: 'Server Vault', description: 'Blinking racks and cold air.', preview: ['#06141c', '#28e0c8'] },
];

/** Stage art is drawn at half resolution and scaled 2x for chunky pixels. */
const W = ARENA_WIDTH / 2;
const H = ARENA_HEIGHT / 2;
const G = GROUND_Y / 2;

export interface StageLayer {
  canvas: HTMLCanvasElement;
  /** Parallax: how far the layer moves per pixel of camera movement (0 = fixed). */
  factor: number;
  /** Overscan (half-res px) on each side so the layer never shows an edge. */
  margin: number;
}

export interface StageArt {
  layers: StageLayer[];
  /** Animated overlay (blinking lights etc.), redrawn cheaply each frame. */
  animate: (ctx: CanvasRenderingContext2D, frame: number, camX: number) => void;
}

/** Draws all layers; camX is the camera offset from the arena centre in world px. */
export function drawStage(ctx: CanvasRenderingContext2D, art: StageArt, frame: number, camX: number): void {
  for (const l of art.layers) {
    const x = Math.round(-l.margin * 2 - camX * l.factor);
    ctx.drawImage(l.canvas, x, 0, l.canvas.width * 2, ARENA_HEIGHT);
  }
  art.animate(ctx, frame, camX);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function vgrad(ctx: CanvasRenderingContext2D, stops: [number, string][], y0 = 0, y1 = H): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
}

/** Horizontal overscan (half-res px) on each side of parallax layers. */
const M = 60;

function rooftop(): StageArt {
  const rng = new Rng(42);
  const LW = W + 2 * M;
  // Layer 0: sky, stars, moon (moves least).
  const [sky, s] = canvas(LW, H);
  const g0 = s.createLinearGradient(0, 0, 0, H);
  g0.addColorStop(0, '#0b0420');
  g0.addColorStop(0.55, '#2b1050');
  g0.addColorStop(1, '#5a1d5e');
  s.fillStyle = g0;
  s.fillRect(0, 0, LW, H);
  for (let i = 0; i < 110; i++) {
    s.fillStyle = rng.chance(0.2) ? '#ffd9a0' : '#c9b8ff';
    s.fillRect(rng.int(0, LW), rng.int(0, 110), 1, 1);
  }
  s.fillStyle = '#ffe9c4';
  for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) if (x * x + y * y <= 144) s.fillRect(M + 390 + x, 42 + y, 1, 1);
  s.fillStyle = '#f2d39b';
  s.fillRect(M + 384, 36, 4, 3);
  s.fillRect(M + 394, 47, 3, 3);

  const skyline = (ctx: CanvasRenderingContext2D, count: number, minH: number, maxH: number, color: string, win: string, baseY: number, winChance: number) => {
    let x = -10;
    for (let i = 0; i < count && x < LW; i++) {
      const w = rng.int(18, 42);
      const h = rng.int(minH, maxH);
      ctx.fillStyle = color;
      ctx.fillRect(x, baseY - h, w, h);
      if (rng.chance(0.3)) ctx.fillRect(x + w / 2 - 1, baseY - h - 8, 2, 8);
      for (let wy = baseY - h + 4; wy < baseY - 4; wy += 5) {
        for (let wx = x + 3; wx < x + w - 3; wx += 4) {
          if (rng.chance(winChance)) {
            ctx.fillStyle = rng.chance(0.15) ? '#ff9a3c' : win;
            ctx.fillRect(wx, wy, 2, 2);
          }
        }
      }
      x += w + rng.int(0, 4);
    }
  };
  // Layer 1: far skyline.
  const [far, f] = canvas(LW, H);
  skyline(f, 40, 60, 130, '#1d0d3a', '#6a4fb0', G - 26, 0.25);
  // Layer 2: near skyline + neon sign.
  const [near, n] = canvas(LW, H);
  skyline(n, 34, 40, 100, '#140828', '#ffcf6e', G - 18, 0.35);
  n.fillStyle = '#1a0a2e';
  n.fillRect(M + 40, 110, 70, 22);
  n.fillStyle = '#ff4fd8';
  n.font = 'bold 10px monospace';
  n.fillText('ARCADE', M + 50, 125);
  // Layer 3: rooftop floor and props (fixed with the fighters).
  const [floor, fl] = canvas(W, H);
  const g3 = fl.createLinearGradient(0, G - 18, 0, H);
  g3.addColorStop(0, '#2a1440');
  g3.addColorStop(1, '#12071f');
  fl.fillStyle = g3;
  fl.fillRect(0, G - 18, W, H - G + 18);
  fl.fillStyle = '#3d1f5c';
  fl.fillRect(0, G - 18, W, 3);
  for (let x = 0; x < W; x += 24) {
    fl.fillStyle = '#1f0f33';
    fl.fillRect(x, G - 15, 1, H - G + 15);
  }
  for (let y = G - 4; y < H; y += 8) {
    fl.fillStyle = '#1f0f33';
    fl.fillRect(0, y, W, 1);
  }
  fl.fillStyle = '#25123d';
  fl.fillRect(20, G - 46, 34, 28);
  fl.fillRect(28, G - 64, 18, 18);
  fl.fillStyle = '#3a1e5a';
  fl.fillRect(22, G - 44, 30, 2);
  fl.fillRect(W - 70, G - 40, 50, 22);
  fl.fillStyle = '#4a2a6e';
  for (let i = 0; i < 5; i++) fl.fillRect(W - 66 + i * 9, G - 36, 6, 2);

  const NEAR = 0.22;
  return {
    layers: [
      { canvas: sky, factor: 0.04, margin: M },
      { canvas: far, factor: 0.1, margin: M },
      { canvas: near, factor: NEAR, margin: M },
      { canvas: floor, factor: 0, margin: 0 },
    ],
    animate: (g, frame, camX) => {
      const off = -camX * NEAR; // lights sit on the near skyline
      const on = Math.floor(frame / 40) % 2 === 0;
      g.fillStyle = on ? '#ff3b3b' : '#5a1020';
      g.fillRect(150 * 2 + off, 60 * 2, 4, 4);
      g.fillRect(330 * 2 + off, 74 * 2, 4, 4);
      const ax = ((frame * 0.3) % (W + 60)) - 30;
      g.fillStyle = '#ffe08a';
      g.fillRect(ax * 2 - camX * 0.04, 30 * 2, 6, 2);
      g.fillStyle = Math.floor(frame / 20) % 2 ? '#ff4fd8' : '#b03a9a';
      g.fillRect(40 * 2 + off, 132 * 2, 140, 2);
    },
  };
}

function arcade(): StageArt {
  const [c, ctx] = canvas(W, H);
  const rng = new Rng(7);
  vgrad(ctx, [
    [0, '#07030f'],
    [1, '#1c0b33'],
  ]);
  // Ceiling lights
  for (let x = 20; x < W; x += 60) {
    ctx.fillStyle = '#3b1f66';
    ctx.fillRect(x, 0, 30, 4);
    ctx.fillStyle = 'rgba(180,77,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x + 30, 4);
    ctx.lineTo(x + 45, 80);
    ctx.lineTo(x - 15, 80);
    ctx.fill();
  }
  // Cabinets
  for (let x = 6; x < W - 30; x += 46) {
    const hue = rng.pick(['#ff7a1a', '#28e0c8', '#ff4fd8', '#ffd23a', '#6a8bff']);
    ctx.fillStyle = '#120822';
    ctx.fillRect(x, G - 120, 38, 102);
    ctx.fillStyle = '#24113f';
    ctx.fillRect(x + 2, G - 118, 34, 12);
    ctx.fillStyle = hue;
    ctx.fillRect(x + 4, G - 116, 30, 8);
    ctx.fillStyle = '#05020a';
    ctx.fillRect(x + 5, G - 102, 28, 26);
    ctx.fillStyle = '#2d1650';
    ctx.fillRect(x + 3, G - 72, 32, 10);
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(x + 8, G - 69, 3, 3);
    ctx.fillStyle = '#3bff8a';
    ctx.fillRect(x + 14, G - 69, 3, 3);
    ctx.fillStyle = '#1a0c30';
    ctx.fillRect(x + 6, G - 58, 26, 40);
  }
  // Checker floor
  for (let y = G - 18; y < H; y += 6) {
    for (let x = 0; x < W; x += 12) {
      ctx.fillStyle = ((x / 12 + (y - G) / 6) & 1) === 0 ? '#1d0e33' : '#140827';
      ctx.fillRect(x, y, 12, 6);
    }
  }
  ctx.fillStyle = '#b44dff';
  ctx.fillRect(0, G - 18, W, 2);
  return {
    layers: [{ canvas: c, factor: 0, margin: 0 }],
    animate: (g, frame) => {
      // Attract-mode screens flicker.
      const r = new Rng(Math.floor(frame / 8) + 1);
      for (let x = 6; x < W - 30; x += 46) {
        const colors = ['#ff7a1a', '#28e0c8', '#ff4fd8', '#ffd23a', '#6a8bff', '#ffffff'];
        for (let i = 0; i < 6; i++) {
          g.fillStyle = r.pick(colors);
          g.fillRect((x + 6 + r.int(0, 24)) * 2, (G - 100 + r.int(0, 22)) * 2, 4, 2);
        }
      }
    },
  };
}

function vault(): StageArt {
  const [c, ctx] = canvas(W, H);
  vgrad(ctx, [
    [0, '#020a10'],
    [1, '#0a2230'],
  ]);
  for (let x = 4; x < W; x += 52) {
    ctx.fillStyle = '#0b1b26';
    ctx.fillRect(x, 30, 44, G - 48);
    ctx.fillStyle = '#10293a';
    ctx.fillRect(x + 2, 32, 40, 4);
    for (let y = 40; y < G - 24; y += 9) {
      ctx.fillStyle = '#06121a';
      ctx.fillRect(x + 3, y, 38, 7);
      ctx.fillStyle = '#163a4f';
      ctx.fillRect(x + 5, y + 2, 20, 1);
    }
  }
  // Cables
  ctx.strokeStyle = '#123040';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 90, 0);
    ctx.quadraticCurveTo(i * 90 + 40, 30, i * 90 + 80, 6);
    ctx.stroke();
  }
  // Floor grating
  vgrad(ctx, [[0, '#0c2733'], [1, '#04121a']], G - 18, H);
  for (let x = 0; x < W; x += 8) {
    ctx.fillStyle = '#0f3140';
    ctx.fillRect(x, G - 18, 1, H);
  }
  ctx.fillStyle = '#28e0c8';
  ctx.fillRect(0, G - 18, W, 1);
  return {
    layers: [{ canvas: c, factor: 0, margin: 0 }],
    animate: (g, frame) => {
      const r = new Rng(Math.floor(frame / 6) + 3);
      for (let x = 4; x < W; x += 52) {
        for (let y = 40; y < G - 24; y += 9) {
          if (r.chance(0.5)) {
            g.fillStyle = r.chance(0.8) ? '#28e0c8' : '#ffb02e';
            g.fillRect((x + 30 + r.int(0, 8)) * 2, (y + 3) * 2, 2, 2);
          }
        }
      }
    },
  };
}

const builders: Record<string, () => StageArt> = { rooftop, arcade, vault };
const built = new Map<string, StageArt>();

export function getStageArt(id: string): StageArt {
  let art = built.get(id);
  if (!art) {
    art = (builders[id] ?? rooftop)();
    built.set(id, art);
  }
  return art;
}
