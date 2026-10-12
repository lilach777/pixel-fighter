import { ARENA_HEIGHT, ARENA_WIDTH, GROUND_Y, PUSHBOX_HALF_WIDTH } from '../../../../shared/src/constants';
import { getCharacter } from '../../../../shared/src/characters/roster';
import { activeHitbox, hurtboxes, projectileBox, pushbox, type Box } from '../../../../shared/src/engine/boxes';
import type { GameEvent } from '../../../../shared/src/engine/sim';
import type { Projectile } from '../../../../shared/src/engine/state';
import type { NetFighter, NetState } from '../../../../shared/src/protocol';
import { chooseFrame } from '../animation/animator';
import type { CharacterSprites } from '../animation/sprites';
import { Effects } from './effects';
import { drawStage, getStageArt } from './stages';

interface TrailSnap {
  x: number;
  y: number;
  key: string;
  facing: 1 | -1;
}
const TRAIL_LEN = 4;

export interface RenderOptions {
  showHitboxes: boolean;
}

/** Draws the arena: stage, fighters, projectiles and effects. HUD is DOM (see components/Hud). */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly effects = new Effects();
  private sprites: [CharacterSprites | null, CharacterSprites | null] = [null, null];
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  /** Last simulation frame seen: effects advance once per SIMULATION frame, not per render. */
  private lastSimFrame = -1;
  private shakeOffset: [number, number] = [0, 0];
  private trails: [TrailSnap[], TrailSnap[]] = [[], []];
  private dustRng = 1;
  /** Animation/frame drawn last for each fighter (debug panel). */
  readonly lastFrames: [{ anim: string; key: string; x: number } | null, { anim: string; key: string; x: number } | null] = [null, null];
  get spritesLoaded(): boolean {
    return !!(this.sprites[0] && this.sprites[1]);
  }

  constructor(
    canvas: HTMLCanvasElement,
    private stageId: string,
  ) {
    canvas.width = ARENA_WIDTH;
    canvas.height = ARENA_HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.scratch = document.createElement('canvas');
    this.scratch.width = 512;
    this.scratch.height = 512;
    this.scratchCtx = this.scratch.getContext('2d')!;
  }

  setSprites(s: [CharacterSprites, CharacterSprites]): void {
    this.sprites = s;
  }

  handleEvents(events: GameEvent[]): void {
    this.effects.handle(events);
  }

  render(state: NetState, opts: RenderOptions): void {
    const ctx = this.ctx;
    // Advance cosmetic effects by the number of simulation frames since the last render
    // (0 when the display refreshes faster than 60 Hz, 2+ after a dropped frame).
    let steps = this.lastSimFrame < 0 || state.frame < this.lastSimFrame ? 1 : state.frame - this.lastSimFrame;
    steps = Math.min(steps, 4);
    this.lastSimFrame = state.frame;
    for (let k = 0; k < steps; k++) this.effects.tick();
    if (steps > 0) {
      const sh = this.effects.shake;
      this.shakeOffset = sh > 0 ? [Math.round((this.rand() - 0.5) * sh), Math.round((this.rand() - 0.5) * sh * 0.6)] : [0, 0];
      for (const slot of this.effects.dashDust.splice(0)) this.effects.dust(state.fighters[slot].x, 4);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    ctx.translate(this.shakeOffset[0], this.shakeOffset[1]);

    // Gentle parallax camera: follows the fighters' midpoint.
    const camX = (state.fighters[0].x + state.fighters[1].x) / 2 - ARENA_WIDTH / 2;
    drawStage(ctx, getStageArt(this.stageId), state.frame, camX);

    // Super flash darkens the stage behind the super's owner.
    const superOwner = state.superFreeze > 0 ? state.superOwner : -1;

    for (const f of state.fighters) this.drawShadow(f);

    // Draw order: whoever is attacking is drawn in front.
    const order = state.fighters[0].action === 'attack' && state.fighters[1].action !== 'attack' ? [1, 0] : [0, 1];
    if (superOwner !== -1) {
      ctx.fillStyle = 'rgba(10,0,25,0.72)';
      ctx.fillRect(-20, -20, ARENA_WIDTH + 40, ARENA_HEIGHT + 40);
      this.drawSuperRays(state.fighters[superOwner], state.superFreeze);
    }
    for (const i of order) this.drawFighter(i as 0 | 1, state.fighters[i], state.frame, superOwner === i, steps > 0);

    for (const p of state.projectiles) this.drawProjectile(p, state.frame);
    this.effects.draw(ctx);

    if (opts.showHitboxes) this.drawDebug(state);

    if (this.effects.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.effects.flash / 24})`;
      ctx.fillRect(-20, -20, ARENA_WIDTH + 40, ARENA_HEIGHT + 40);
    }
    ctx.restore();
  }

  /** Small deterministic PRNG for cosmetic jitter (no Math.random in the render path). */
  private rand(): number {
    this.dustRng = (this.dustRng * 1103515245 + 12345) & 0x7fffffff;
    return this.dustRng / 0x7fffffff;
  }

  private drawShadow(f: NetFighter): void {
    const ctx = this.ctx;
    const h = Math.max(0, GROUND_Y - f.y);
    const s = Math.max(0.35, 1 - h / 260);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(f.x, GROUND_Y - 2, 38 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFighter(i: 0 | 1, f: NetFighter, frame: number, glowing: boolean, newSimFrame: boolean): void {
    const sprites = this.sprites[i];
    const ctx = this.ctx;
    if (!sprites) {
      // Assets still loading: simple silhouette so the match stays readable.
      const s = getCharacter(f.char).stats;
      ctx.fillStyle = getCharacter(f.char).accent;
      ctx.fillRect(f.x - s.width / 2, f.y - s.height, s.width, s.height);
      return;
    }
    const choice = chooseFrame(sprites, f, frame);
    this.lastFrames[i] = { ...choice, x: f.x };
    const fm = sprites.frames.get(choice.key);
    if (!fm) return;
    const scale = sprites.scale;
    const w = fm.rect.w * scale;
    const h = fm.rect.h * scale;
    // Anticipation: heavy moves lean back slightly during startup (art-space offset).
    const move = f.action === 'attack' && f.move ? getCharacter(f.char).moves[f.move] : null;
    const lean = move && move.startup >= 8 && f.actionFrame < move.startup ? -Math.min(4, f.actionFrame) : 0;
    let x = f.x - fm.anchor.x * scale + lean;
    const y = f.y - fm.anchor.y * scale;
    if (f.action === 'hitstun' && f.actionFrame < 8) x += f.actionFrame % 2 ? 3 : -3;

    // Motion trail for dashes and specials/supers: afterimages of recent positions.
    const trailing = f.action === 'dash' || (f.action === 'attack' && (f.move === 'special' || f.move === 'specialAlt' || f.move === 'super'));
    const trail = this.trails[i];
    if (newSimFrame) {
      if (trailing && frame % 2 === 0) {
        trail.unshift({ x: f.x, y: f.y, key: choice.key, facing: f.facing });
        if (trail.length > TRAIL_LEN) trail.pop();
      } else if (!trailing) trail.length = 0;
    }
    if (trail.length) this.drawTrail(sprites, trail, getCharacter(f.char).accent);

    ctx.save();
    if (f.facing === -1) {
      ctx.translate(f.x * 2, 0);
      ctx.scale(-1, 1);
    }
    if (glowing) {
      ctx.shadowColor = getCharacter(f.char).accent;
      ctx.shadowBlur = 24;
    }
    if (f.flash > 0 && fm.rect.w <= 512 && fm.rect.h <= 512) {
      // White hit flash: tint a copy of the frame.
      const sc = this.scratchCtx;
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, fm.rect.w, fm.rect.h);
      sc.drawImage(sprites.image, fm.rect.x, fm.rect.y, fm.rect.w, fm.rect.h, 0, 0, fm.rect.w, fm.rect.h);
      sc.globalCompositeOperation = 'source-atop';
      // Brief white hit flash, kept translucent so the character stays recognisable.
      sc.fillStyle = `rgba(255,255,255,${Math.min(0.5, f.flash / 14)})`;
      sc.fillRect(0, 0, fm.rect.w, fm.rect.h);
      ctx.drawImage(this.scratch, 0, 0, fm.rect.w, fm.rect.h, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    } else {
      ctx.drawImage(sprites.image, fm.rect.x, fm.rect.y, fm.rect.w, fm.rect.h, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }
    ctx.restore();
    // Blocking shield shimmer.
    if (f.action === 'blockstun') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#7fc8ff';
      ctx.lineWidth = 3;
      const s = getCharacter(f.char).stats;
      const top = f.crouching ? s.crouchHeight : s.height;
      ctx.strokeRect(f.x + f.facing * 20 - 6, f.y - top, 12, top - 10);
      ctx.restore();
    }
  }

  private drawTrail(sprites: CharacterSprites, trail: TrailSnap[], color: string): void {
    const ctx = this.ctx;
    const sc = this.scratchCtx;
    trail.forEach((t, k) => {
      if (k === 0) return; // newest snapshot is the sprite itself
      const fm = sprites.frames.get(t.key);
      if (!fm || fm.rect.w > 512 || fm.rect.h > 512) return;
      // Tint a copy of the frame in the character's accent colour (reused scratch canvas).
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, fm.rect.w, fm.rect.h);
      sc.drawImage(sprites.image, fm.rect.x, fm.rect.y, fm.rect.w, fm.rect.h, 0, 0, fm.rect.w, fm.rect.h);
      sc.globalCompositeOperation = 'source-atop';
      sc.fillStyle = color;
      sc.fillRect(0, 0, fm.rect.w, fm.rect.h);
      const s = sprites.scale;
      ctx.save();
      ctx.globalAlpha = 0.32 - k * 0.08;
      if (t.facing === -1) {
        ctx.translate(t.x * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.scratch, 0, 0, fm.rect.w, fm.rect.h, Math.round(t.x - fm.anchor.x * s), Math.round(t.y - fm.anchor.y * s), Math.round(fm.rect.w * s), Math.round(fm.rect.h * s));
      ctx.restore();
    });
  }

  private drawSuperRays(f: NetFighter, t: number): void {
    const ctx = this.ctx;
    const color = getCharacter(f.char).accent;
    ctx.save();
    ctx.translate(f.x, f.y - 90);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = color;
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + t * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 700, Math.sin(a) * 700);
      ctx.lineTo(Math.cos(a + 0.08) * 700, Math.sin(a + 0.08) * 700);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawProjectile(p: Projectile, frame: number): void {
    const ctx = this.ctx;
    const dir = Math.sign(p.vx) || 1;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(dir, 1);
    const flick = frame % 4 < 2;
    if (p.effect === 'crescent') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(-8, 0, p.h / 2, -Math.PI / 2, Math.PI / 2);
      ctx.arc(-18, 0, p.h / 2 - 6, Math.PI / 2, -Math.PI / 2, true);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, -4, 6, 8);
    } else if (p.effect === 'sparks') {
      for (let i = 0; i < 14; i++) {
        const k = (i * 37 + frame * 7) % 60;
        ctx.fillStyle = i % 3 === 0 ? '#ffffff' : p.color;
        ctx.fillRect(-p.w / 2 + ((k * 13) % p.w), -p.h / 2 + ((k * 7) % p.h), 4, 4);
      }
    } else {
      // Pixel fireball / wave: layered squares with a flickering trail.
      const r = p.h / 2;
      for (let t = 0; t < 5; t++) {
        ctx.globalAlpha = 0.18 * (5 - t);
        ctx.fillStyle = p.color;
        const s = r * (1 - t * 0.15);
        ctx.fillRect(-t * 12 - s, -s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(-r, -r * 0.8, r * 2, r * 1.6);
      ctx.fillStyle = '#ffd23a';
      ctx.fillRect(-r * 0.6, -r * 0.55, r * 1.4, r * 1.1);
      ctx.fillStyle = flick ? '#ffffff' : '#fff4c0';
      ctx.fillRect(-r * 0.2, -r * 0.3, r * 0.9, r * 0.6);
      if (p.effect === 'wave') {
        ctx.fillStyle = p.color;
        ctx.fillRect(r * 0.6, -r * 1.1, 8, r * 2.2);
      }
    }
    ctx.restore();
  }

  private drawDebug(state: NetState): void {
    const ctx = this.ctx;
    const stroke = (b: Box, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h));
    };
    for (const f of state.fighters) {
      stroke(pushbox(f, PUSHBOX_HALF_WIDTH), 'rgba(255,230,0,0.8)');
      for (const h of hurtboxes(f)) stroke(h, 'rgba(60,255,120,0.9)');
      const hb = activeHitbox(f);
      if (hb) {
        ctx.fillStyle = 'rgba(255,40,40,0.35)';
        ctx.fillRect(hb.box.x, hb.box.y, hb.box.w, hb.box.h);
        stroke(hb.box, 'rgba(255,40,40,1)');
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(f.x - 1, f.y - 6, 2, 12);
    }
    for (const p of state.projectiles) stroke(projectileBox(p), 'rgba(255,80,80,1)');
  }
}
