import { TICK_MS } from '../../../../shared/src/constants';
import { CHARACTER_IDS } from '../../../../shared/src/characters/roster';
import { stepMatch } from '../../../../shared/src/engine/sim';
import { createMatch, type MatchState } from '../../../../shared/src/engine/state';
import { Rng } from '../../../../shared/src/rng';
import { loadCharacterSprites } from '../animation/sprites';
import { blendPositions, capturePositions, type PositionSnapshot } from '../engine/interpolation';
import { Renderer } from '../rendering/renderer';
import { FightDirector, sustainDemo } from './director';

const SPRITE_HEIGHT = 168;
const EXCHANGES_PER_PAIR = 7;
const FADE_FRAMES = 24;

export interface DemoStats {
  running: boolean;
  pair: [string, string] | null;
  pairsShown: number;
  frames: number;
  hits: number;
  blocks: number;
  specials: number;
  supers: number;
}

/** Only one demo loop may run at a time (guards against StrictMode / remounts). */
let active: TitleDemo | null = null;

interface Ember {
  x: number;
  y: number;
  vy: number;
  vx: number;
  life: number;
}

/**
 * Title-screen fight: two random roster fighters on the real engine, driven by the
 * FightDirector, rendered with the normal renderer plus atmosphere. Fully independent of
 * gameplay: private MatchState, no keyboard, no audio, nothing shared with matches.
 */
export class TitleDemo {
  readonly stats: DemoStats = { running: false, pair: null, pairsShown: 0, frames: 0, hits: 0, blocks: 0, specials: 0, supers: 0 };
  private state: MatchState | null = null;
  private director = new FightDirector(Date.now() & 0xffff);
  private renderer: Renderer;
  private rng = new Rng(Date.now() & 0xffff);
  private raf = 0;
  private last = 0;
  private acc = 0;
  private prev: PositionSnapshot | null = null;
  private fade = 0; // >0 fading out, <0 fading in
  private nextPair: [string, string] | null = null;
  private embers: Ember[] = [];
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, 'rooftop');
    for (let i = 0; i < 36; i++) this.embers.push(this.spawnEmber(true));
  }

  start(): void {
    if (active && active !== this) active.stop();
    active = this;
    this.stats.running = true;
    void this.beginPair(this.pickPair());
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stats.running = false;
    if (active === this) active = null;
  }

  private onVisibility = () => {
    // Do not fast-forward after the tab comes back.
    this.last = performance.now();
    this.acc = 0;
  };

  private pickPair(exclude?: [string, string]): [string, string] {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rng.pick(CHARACTER_IDS);
      let b = this.rng.pick(CHARACTER_IDS);
      while (b === a) b = this.rng.pick(CHARACTER_IDS);
      if (!exclude || (a !== exclude[0] && a !== exclude[1]) || tries > 10) return [a, b];
    }
    return [CHARACTER_IDS[0], CHARACTER_IDS[1]];
  }

  private async beginPair(pair: [string, string]): Promise<void> {
    const sprites = await Promise.all([loadCharacterSprites(pair[0], SPRITE_HEIGHT), loadCharacterSprites(pair[1], SPRITE_HEIGHT)]);
    if (!this.stats.running) return;
    const s = createMatch(pair[0], pair[1]);
    // Skip the round intro: the demo starts mid-fight, well spaced.
    s.phase = 'fight';
    s.phaseFrame = 200;
    for (const f of s.fighters) {
      f.action = 'idle';
      f.actionFrame = 0;
    }
    this.renderer.setSprites(sprites);
    this.state = s;
    this.prev = null;
    this.director = new FightDirector(this.rng.int(1, 1e6));
    this.stats.pair = pair;
    this.stats.pairsShown++;
    this.fade = -FADE_FRAMES;
    // Preload the next pair so the swap is instant.
    this.nextPair = this.pickPair(pair);
    void loadCharacterSprites(this.nextPair[0], SPRITE_HEIGHT).catch(() => undefined);
    void loadCharacterSprites(this.nextPair[1], SPRITE_HEIGHT).catch(() => undefined);
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 4) {
      this.step();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    this.draw();
  };

  /** One 60 Hz demo step. */
  step(): void {
    this.frame++;
    this.updateEmbers();
    const s = this.state;
    if (!s) return;
    this.stats.frames++;
    if (this.fade > 0) {
      this.fade--;
      if (this.fade === 0 && this.nextPair) {
        this.state = null;
        void this.beginPair(this.nextPair);
      }
      return;
    }
    if (this.fade < 0) this.fade++;
    this.prev = capturePositions(s);
    const events = stepMatch(s, this.director.update(s));
    sustainDemo(s);
    for (const e of events) {
      if (e.type === 'hit') this.stats.hits++;
      else if (e.type === 'block') this.stats.blocks++;
      else if (e.type === 'special') this.stats.specials++;
      else if (e.type === 'super') this.stats.supers++;
    }
    this.renderer.handleEvents(events);
    // Rotate fighters after a few exchanges, between beats (both standing).
    const calm = s.fighters.every((f) => f.action === 'idle') && s.projectiles.length === 0;
    if (this.director.exchanges >= EXCHANGES_PER_PAIR && calm && this.fade === 0) this.fade = FADE_FRAMES;
  }

  private draw(): void {
    const ctx = this.renderer.ctx;
    if (this.state) {
      this.renderer.render(blendPositions(this.state, this.prev, this.acc / TICK_MS), { showHitboxes: false });
    } else {
      ctx.fillStyle = '#0b0420';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.drawAtmosphere(ctx);
    const f = this.fade > 0 ? 1 - this.fade / FADE_FRAMES : this.fade < 0 ? -this.fade / FADE_FRAMES : this.state ? 0 : 1;
    if (f > 0) {
      ctx.fillStyle = `rgba(8,2,18,${f})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private spawnEmber(anywhere = false): Ember {
    return {
      x: this.rng.next() * this.canvas.width,
      y: anywhere ? this.rng.next() * this.canvas.height : this.canvas.height + 4,
      vy: -(0.3 + this.rng.next() * 0.7),
      vx: (this.rng.next() - 0.5) * 0.3,
      life: 200 + this.rng.int(0, 300),
    };
  }

  private updateEmbers(): void {
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      e.x += e.vx + Math.sin((this.frame + i * 37) / 40) * 0.15;
      e.y += e.vy;
      e.life--;
      if (e.life <= 0 || e.y < -4) Object.assign(e, this.spawnEmber());
    }
  }

  /** Drifting haze bands and rising embers (cheap, fixed-size, no allocation per frame). */
  private drawAtmosphere(ctx: CanvasRenderingContext2D): void {
    const W = this.canvas.width;
    ctx.save();
    for (let k = 0; k < 3; k++) {
      const y = 300 + k * 50 + Math.sin(this.frame / (90 + k * 30)) * 10;
      const x = ((this.frame * (0.2 + k * 0.1)) % (W + 400)) - 400;
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = k === 1 ? '#ff4fd8' : '#b44dff';
      ctx.fillRect(x, y, 400, 26);
      ctx.fillRect(x - W - 400, y, 400, 26);
    }
    for (const e of this.embers) {
      ctx.globalAlpha = Math.min(1, e.life / 120) * 0.8;
      ctx.fillStyle = e.life % 50 < 25 ? '#ffb347' : '#ff7a1a';
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 2, 2);
    }
    ctx.restore();
  }
}
