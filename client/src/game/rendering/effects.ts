import { GROUND_Y } from '../../../../shared/src/constants';
import type { GameEvent } from '../../../../shared/src/engine/sim';
import { Rng } from '../../../../shared/src/rng';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
}

interface Burst {
  kind: 'hit' | 'heavy' | 'block' | 'clash' | 'counter' | 'armor';
  x: number;
  y: number;
  age: number;
  life: number;
}

/** Hard caps so a long combo or a super can never flood the frame. */
export const MAX_PARTICLES = 220;
export const MAX_BURSTS = 24;

/**
 * Original pixel effects spawned from simulation events. Purely cosmetic.
 * tick() must be called once per SIMULATION frame (not per rendered frame), so effects run
 * at the same speed on 60, 120 and 144 Hz displays. Particles are pooled and capped.
 */
export class Effects {
  particles: Particle[] = [];
  bursts: Burst[] = [];
  private pool: Particle[] = [];
  shake = 0;
  /** Slots that dashed this frame (renderer turns these into dust at the fighter's feet). */
  dashDust: number[] = [];
  flash = 0;
  private rng = new Rng(99);

  handle(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.burst({ kind: e.heavy ? 'heavy' : 'hit', x: e.x, y: e.y, age: 0, life: e.heavy ? 16 : 11 });
          this.spray(e.x, e.y, e.heavy ? 18 : 9, ['#ffffff', '#ffe08a', '#ff9a3c', '#ff5a1a'], e.heavy ? 6 : 4);
          // Screen shake is reserved for genuinely big hits.
          if (e.damage >= 70) this.shake = Math.max(this.shake, Math.min(9, e.damage / 10));
          break;
        case 'block':
          this.burst({ kind: 'block', x: e.x, y: e.y, age: 0, life: 12 });
          this.spray(e.x, e.y, 6, ['#9fd8ff', '#ffffff', '#4f8bff'], 3);
          this.shake = Math.max(this.shake, 2);
          break;
        case 'clash':
          this.burst({ kind: 'clash', x: e.x, y: e.y, age: 0, life: 18 });
          this.spray(e.x, e.y, 16, ['#ffffff', '#ffd23a'], 5);
          break;
        case 'counter':
          this.burst({ kind: 'counter', x: e.x, y: e.y, age: 0, life: 30 });
          break;
        case 'armor':
          this.burst({ kind: 'armor', x: e.x, y: e.y, age: 0, life: 14 });
          break;
        case 'dash':
          this.dashDust.push(e.slot);
          break;
        case 'knockdown':
          this.dust(e.x, 10);
          this.shake = Math.max(this.shake, 5);
          break;
        case 'ko':
          this.flash = 18;
          this.shake = Math.max(this.shake, 14);
          break;
        case 'super':
          this.flash = 6;
          break;
        default:
          break;
      }
    }
  }

  private burst(b: Burst): void {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push(b);
  }

  /** Reuses a dead particle object when available; drops new ones at the cap. */
  private particle(): Particle | null {
    if (this.particles.length >= MAX_PARTICLES) return null;
    const p = this.pool.pop() ?? ({} as Particle);
    this.particles.push(p);
    return p;
  }

  private spray(x: number, y: number, n: number, colors: string[], speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const s = speed * (0.4 + this.rng.next());
      const p = this.particle();
      if (!p) return;
      Object.assign(p, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 0, max: 12 + this.rng.int(0, 10), size: this.rng.chance(0.3) ? 4 : 2, color: this.rng.pick(colors), gravity: 0.25 });
    }
  }

  dust(x: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.particle();
      if (!p) return;
      Object.assign(p, { x: x + this.rng.int(-30, 30), y: GROUND_Y - 4, vx: this.rng.next() * 3 - 1.5, vy: -this.rng.next() * 2, life: 0, max: 20 + this.rng.int(0, 10), size: 4, color: this.rng.pick(['#9c8aa8', '#c9b8d8', '#6e5c7c']), gravity: 0.05 });
    }
  }

  /** Advances cosmetic effects by one frame. */
  tick(): void {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.94;
      p.life++;
    }
    // Compact in place, returning dead particles to the pool (no per-frame allocation).
    let w = 0;
    for (const p of this.particles) {
      if (p.life < p.max) this.particles[w++] = p;
      else this.pool.push(p);
    }
    this.particles.length = w;
    for (const b of this.bursts) b.age++;
    this.bursts = this.bursts.filter((b) => b.age < b.life);
    if (this.shake > 0) this.shake *= 0.82;
    if (this.shake < 0.5) this.shake = 0;
    if (this.flash > 0) this.flash--;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bursts) {
      const t = b.age / b.life;
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      if (b.kind === 'hit' || b.kind === 'heavy') {
        const r = (b.kind === 'heavy' ? 46 : 28) * (0.4 + t);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#ffffff';
        drawStar(ctx, 8, r, r * 0.35);
        ctx.fillStyle = b.kind === 'heavy' ? '#ff7a1a' : '#ffd23a';
        drawStar(ctx, 8, r * 0.6, r * 0.2);
      } else if (b.kind === 'block') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#7fc8ff';
        ctx.lineWidth = 4;
        const r = 22 + t * 18;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (b.kind === 'clash') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + t * 60, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === 'armor') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffb02e';
        ctx.lineWidth = 5;
        ctx.strokeRect(-30 - t * 10, -50 - t * 10, 60 + t * 20, 100 + t * 20);
      } else if (b.kind === 'counter') {
        ctx.globalAlpha = Math.min(1, 2 - t * 2);
        ctx.fillStyle = '#ffd23a';
        ctx.strokeStyle = '#3a0a00';
        ctx.lineWidth = 4;
        ctx.font = '16px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.strokeText('COUNTER!', 0, -40 - t * 20);
        ctx.fillText('COUNTER!', 0, -40 - t * 20);
      }
      ctx.restore();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}

function drawStar(ctx: CanvasRenderingContext2D, points: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI / points) * i;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
