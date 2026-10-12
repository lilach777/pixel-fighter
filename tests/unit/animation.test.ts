import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS } from '../../shared/src/characters/roster';
import { stepMatch, type GameEvent } from '../../shared/src/engine/sim';
import { createMatch } from '../../shared/src/engine/state';
import { Btn } from '../../shared/src/input';
import { FightDirector, sustainDemo } from '../../client/src/game/demo/director';
import { blendPositions, capturePositions } from '../../client/src/game/engine/interpolation';
import { Effects, MAX_BURSTS, MAX_PARTICLES } from '../../client/src/game/rendering/effects';
import { fightState, run } from './helpers';

const CHAR_DIR = path.resolve(import.meta.dirname, '..', '..', 'client', 'public', 'assets', 'characters');

describe('sprite anchoring', () => {
  /** Horizontal drift of the trunk (relative to the anchor) between consecutive cycle frames. */
  function maxTrunkStep(id: string, anim: string): number {
    const m = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, 'metadata', `${id}.json`), 'utf8'));
    const a = PNG.sync.read(fs.readFileSync(path.join(CHAR_DIR, m.atlas)));
    const fr = new Map<string, any>(m.frames.map((f: any) => [f.key, f]));
    const trunk = (k: string) => {
      const f = fr.get(k);
      const top = f.anchor.y - f.bodyHeight;
      let sx = 0;
      let n = 0;
      for (let y = Math.round(top + f.bodyHeight * 0.3); y < top + f.bodyHeight * 0.6; y++)
        for (let x = 0; x < f.rect.w; x++)
          if (a.data[((f.rect.y + y) * a.width + f.rect.x + x) * 4 + 3] > 128) {
            sx += x;
            n++;
          }
      return sx / n - f.anchor.x;
    };
    const t = (m.animations[anim].frames as string[]).map(trunk);
    let max = 0;
    for (let i = 1; i < t.length; i++) max = Math.max(max, Math.abs(t[i] - t[i - 1]));
    return max;
  }

  // With feet-centroid anchors these cycles jumped 20-59 sheet px between frames.
  it.each(CHARACTER_IDS)('%s: walk and run cycles keep the body planted (trunk anchor)', (id) => {
    expect(maxTrunkStep(id, 'walk')).toBeLessThan(12);
    expect(maxTrunkStep(id, 'run')).toBeLessThan(20);
    expect(maxTrunkStep(id, 'idle')).toBeLessThan(16);
  });
});

describe('render interpolation', () => {
  it('blends positions between steps without touching the simulation state', () => {
    const s = fightState('rick', 'koala', [300, 700]);
    const prev = capturePositions(s);
    run(s, 1, [Btn.RIGHT, 0]);
    const x1 = s.fighters[0].x;
    const view = blendPositions(s, prev, 0.5);
    expect(view.fighters[0].x).toBeCloseTo((300 + x1) / 2, 5);
    expect(view.fighters[0].action).toBe(s.fighters[0].action);
    expect(s.fighters[0].x).toBe(x1); // state untouched
    expect(blendPositions(s, prev, 1)).toBe(s);
  });

  it('never smears teleports such as round resets', () => {
    const s = fightState('rick', 'koala', [300, 700]);
    const prev = capturePositions(s);
    s.fighters[0].x = 600;
    expect(blendPositions(s, prev, 0.5).fighters[0].x).toBe(600);
  });
});

describe('effects', () => {
  const hit = (damage: number): GameEvent => ({ type: 'hit', attacker: 0, x: 100, y: 100, damage, combo: 1, heavy: damage >= 70, projectile: false });

  it('caps particles and bursts and reuses particle objects', () => {
    const fx = new Effects();
    for (let i = 0; i < 200; i++) fx.handle([hit(90)]);
    expect(fx.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(fx.bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
    const before = new Set(fx.particles);
    for (let i = 0; i < 60; i++) fx.tick();
    expect(fx.particles.length).toBe(0);
    fx.handle([hit(90)]);
    expect(fx.particles.length).toBeGreaterThan(0);
    expect(fx.particles.every((p) => before.has(p))).toBe(true); // pooled objects reused
  });

  it('shakes the screen only for powerful hits', () => {
    const fx = new Effects();
    fx.handle([hit(32)]);
    expect(fx.shake).toBe(0);
    fx.handle([hit(100)]);
    expect(fx.shake).toBeGreaterThan(0);
  });

  it('only spawns impact effects from real hit events', () => {
    const fx = new Effects();
    fx.handle([{ type: 'jump', slot: 0 }]);
    expect(fx.bursts).toHaveLength(0);
  });
});

describe('title-screen fight director', () => {
  it.each([
    ['rick', 'koala'],
    ['migo', 'jeff-garzik'],
    ['jcv', 'max-sanchez'],
  ])('%s vs %s: a varied, endless fight with pauses, on its own private state', (p1, p2) => {
    const s = createMatch(p1, p2);
    s.phase = 'fight';
    for (const f of s.fighters) f.action = 'idle';
    const d = new FightDirector(11);
    const counts: Record<string, number> = {};
    let idle = 0;
    let longestIdle = 0;
    let longestBusy = 0;
    let busy = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const ev = stepMatch(s, d.update(s));
      sustainDemo(s);
      for (const e of ev) counts[e.type] = (counts[e.type] ?? 0) + 1;
      const still = s.fighters.every((f) => f.action === 'idle');
      idle = still ? idle + 1 : 0;
      busy = still ? 0 : busy + 1;
      longestIdle = Math.max(longestIdle, idle);
      longestBusy = Math.max(longestBusy, busy);
    }
    expect(s.phase).toBe('fight'); // never KOs or times out
    expect(d.exchanges).toBeGreaterThan(20);
    expect(counts.hit).toBeGreaterThan(20);
    expect(counts.block).toBeGreaterThan(5);
    expect(counts.knockdown).toBeGreaterThan(2);
    expect((counts.special ?? 0) + (counts.super ?? 0)).toBeGreaterThan(2);
    expect(longestIdle).toBeGreaterThan(30); // real pauses between exchanges...
    expect(longestIdle).toBeLessThan(60 * 3); // ...but never stands around for long
    expect(new Set(d.history).size).toBeGreaterThanOrEqual(6);
    for (const f of s.fighters) {
      expect(f.x).toBeGreaterThanOrEqual(36);
      expect(f.x).toBeLessThanOrEqual(924);
    }
  });
});
