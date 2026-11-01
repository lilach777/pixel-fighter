import { describe, expect, it } from 'vitest';
import { stepMatch } from '../../shared/src/engine/sim';
import { createMatch } from '../../shared/src/engine/state';
import { Btn } from '../../shared/src/input';
import { toNetState } from '../../shared/src/protocol';
import { ComboTracker, deriveHud } from '../../client/src/game/hud';
import { P1_DEFAULT, bitsFromKeys } from '../../client/src/game/input/bindings';
import { interpolate } from '../../client/src/multiplayer/onlineRunner';
import { fightState, run } from './helpers';

describe('keyboard bindings', () => {
  it('maps the specified default keys', () => {
    expect(bitsFromKeys(P1_DEFAULT, new Set(['KeyA', 'KeyF', 'KeyH']))).toBe(Btn.LEFT | Btn.LP | Btn.SP);
    expect(bitsFromKeys(P1_DEFAULT, new Set(['KeyW', 'KeyS', 'KeyG', 'KeyV', 'KeyB', 'KeyJ', 'KeyD']))).toBe(
      Btn.UP | Btn.DOWN | Btn.HP | Btn.LK | Btn.HK | Btn.SU | Btn.RIGHT,
    );
  });
});

describe('HUD', () => {
  it('shows round intro, FIGHT, KO and winner banners', () => {
    const combos = new ComboTracker();
    const s = createMatch('rick', 'koala');
    const names: [string, string] = ['Rick', 'Koala'];
    expect(deriveHud(toNetState(s), names, combos).banner).toBe('ROUND 1');
    run(s, 100);
    expect(deriveHud(toNetState(s), names, combos).banner).toBe('FIGHT!');
    const f = fightState('rick', 'koala', [400, 470]);
    f.fighters[1].health = 1;
    stepMatch(f, [Btn.HP, 0]);
    run(f, 12);
    let hud = deriveHud(toNetState(f), names, combos);
    expect(hud.banner).toBe('K.O.');
    run(f, 90);
    hud = deriveHud(toNetState(f), names, combos);
    expect(hud.banner).toBe('RICK WINS');
    expect(hud.sides[0].wins).toBe(1);
    expect(hud.timer).toBeLessThanOrEqual(60);
  });

  it('tracks combo counters from hit events', () => {
    const combos = new ComboTracker();
    combos.handle([{ type: 'hit', attacker: 0, x: 0, y: 0, damage: 10, combo: 3, heavy: false, projectile: false }], 100);
    expect(combos.get(0, 120)).toBe(3);
    expect(combos.get(1, 120)).toBe(0);
    expect(combos.get(0, 200)).toBe(0);
  });
});

describe('snapshot interpolation', () => {
  it('interpolates positions between snapshots and keeps discrete state', () => {
    const a = createMatch('rick', 'koala');
    const b = structuredClone(a);
    b.fighters[0].x += 20;
    b.fighters[0].health -= 50;
    const mid = interpolate(toNetState(a), toNetState(b), 0.5);
    expect(mid.fighters[0].x).toBe(a.fighters[0].x + 10);
    expect(mid.fighters[0].health).toBe(a.fighters[0].health);
    expect(interpolate(toNetState(a), toNetState(b), 1).fighters[0].health).toBe(b.fighters[0].health);
  });

  it('does not smear teleports across round resets', () => {
    const a = createMatch('rick', 'koala');
    const b = structuredClone(a);
    b.fighters[0].x = a.fighters[0].x + 400;
    expect(interpolate(toNetState(a), toNetState(b), 0.5).fighters[0].x).toBe(a.fighters[0].x);
  });
});
