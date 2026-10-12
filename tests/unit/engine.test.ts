import { describe, expect, it } from 'vitest';
import { COMBO_SCALING, GROUND_Y, METER_MAX, PUSHBOX_HALF_WIDTH, ROUND_END_FRAMES, STAGE_LEFT, STAGE_RIGHT } from '../../shared/src/constants';
import { getCharacter } from '../../shared/src/characters/roster';
import { activeHitbox, hurtboxes, overlaps, toWorld } from '../../shared/src/engine/boxes';
import { stepMatch } from '../../shared/src/engine/sim';
import { createMatch, timerSeconds } from '../../shared/src/engine/state';
import { Btn } from '../../shared/src/input';
import { fightState, run, tap, until } from './helpers';

const hits = (ev: { type: string }[]) => ev.filter((e) => e.type === 'hit');

describe('match setup', () => {
  it('starts with an intro, 60 second timer and best-of-three', () => {
    const s = createMatch('rick', 'koala');
    expect(s.phase).toBe('intro');
    expect(timerSeconds(s)).toBe(60);
    expect(s.config.roundsToWin).toBe(2);
    const ev = run(s, 100);
    expect(ev.map((e) => e.type)).toContain('fight');
    expect(s.phase).toBe('fight');
  });

  it('ignores inputs during the intro', () => {
    const s = createMatch('rick', 'koala');
    const x = s.fighters[0].x;
    run(s, 50, [Btn.RIGHT | Btn.LP, 0]);
    expect(s.fighters[0].x).toBe(x);
    expect(s.fighters[0].action).toBe('intro');
  });
});

describe('movement', () => {
  it('walks forward at walk speed and backward slower', () => {
    const s = fightState('joshua', 'joshua', [300, 700]);
    const st = getCharacter('joshua').stats;
    run(s, 30, [Btn.RIGHT, 0]);
    expect(s.fighters[0].action).toBe('walk');
    expect(s.fighters[0].x).toBeCloseTo(300 + st.walkSpeed * 30, 0);
    const x = s.fighters[0].x;
    run(s, 30, [Btn.LEFT, 0]);
    expect(s.fighters[0].action).toBe('walkBack');
    expect(x - s.fighters[0].x).toBeCloseTo(st.backWalkSpeed * 30, 0);
  });

  it('jumps with gravity and lands back on the ground', () => {
    const s = fightState('joshua', 'joshua', [300, 700]);
    const st = getCharacter('joshua').stats;
    let minY = GROUND_Y;
    let airFrames = 0;
    stepMatch(s, [Btn.UP, 0]);
    for (let i = 0; i < 80; i++) {
      stepMatch(s, [0, 0]);
      minY = Math.min(minY, s.fighters[0].y);
      if (s.fighters[0].airborne) airFrames++;
    }
    const expectedApex = (st.jumpVelocity * st.jumpVelocity) / (2 * 0.92);
    expect(GROUND_Y - minY).toBeGreaterThan(expectedApex * 0.85);
    expect(GROUND_Y - minY).toBeLessThan(expectedApex * 1.1);
    expect(airFrames).toBeGreaterThan(30);
    expect(airFrames).toBeLessThan(45);
    expect(s.fighters[0].y).toBe(GROUND_Y);
    expect(s.fighters[0].airborne).toBe(false);
  });

  it('forward jump travels toward the opponent', () => {
    const s = fightState('joshua', 'joshua', [300, 700]);
    stepMatch(s, [Btn.UP | Btn.RIGHT, 0]);
    run(s, 20);
    expect(s.fighters[0].x).toBeGreaterThan(330);
  });

  it('crouches while down is held', () => {
    const s = fightState();
    run(s, 3, [Btn.DOWN, 0]);
    expect(s.fighters[0].action).toBe('crouch');
    const stand = getCharacter('joshua').stats;
    const hb = hurtboxes(s.fighters[0])[0];
    expect(hb.h).toBe(stand.crouchHeight);
  });

  it('double-tap forward dashes, double-tap back backdashes', () => {
    const s = fightState('joshua', 'joshua', [300, 800]);
    stepMatch(s, [Btn.RIGHT, 0]);
    stepMatch(s, [0, 0]);
    stepMatch(s, [Btn.RIGHT, 0]);
    expect(s.fighters[0].action).toBe('dash');
    run(s, 16);
    expect(s.fighters[0].x).toBeGreaterThan(300 + 60);
    run(s, 4);
    const x = s.fighters[0].x;
    stepMatch(s, [Btn.LEFT, 0]);
    stepMatch(s, [0, 0]);
    stepMatch(s, [Btn.LEFT, 0]);
    expect(s.fighters[0].action).toBe('backdash');
    run(s, 15);
    expect(s.fighters[0].x).toBeLessThan(x - 40);
  });

  it('keeps fighters inside the arena and separated by pushboxes', () => {
    const s = fightState('joshua', 'joshua', [100, 160]);
    run(s, 300, [Btn.LEFT, Btn.LEFT]);
    expect(s.fighters[0].x).toBeGreaterThanOrEqual(STAGE_LEFT);
    expect(s.fighters[1].x - s.fighters[0].x).toBeGreaterThanOrEqual(PUSHBOX_HALF_WIDTH * 2 - 0.01);
    run(s, 400, [Btn.RIGHT, Btn.RIGHT]);
    expect(s.fighters[1].x).toBeLessThanOrEqual(STAGE_RIGHT);
    expect(s.fighters[1].x - s.fighters[0].x).toBeGreaterThanOrEqual(PUSHBOX_HALF_WIDTH * 2 - 0.01);
  });

  it('turns fighters to face each other when they switch sides', () => {
    const s = fightState('joshua', 'joshua', [400, 520]);
    s.fighters[0].x = 600;
    s.fighters[1].x = 300;
    stepMatch(s, [0, 0]);
    expect(s.fighters[0].facing).toBe(-1);
    expect(s.fighters[1].facing).toBe(1);
  });
});

describe('hitboxes and attack timing', () => {
  it('converts facing-relative boxes to world space for both directions', () => {
    const r = { x: 10, y: -100, w: 50, h: 20 };
    expect(toWorld({ x: 100, y: GROUND_Y, facing: 1 }, r)).toEqual({ x: 110, y: GROUND_Y - 100, w: 50, h: 20 });
    expect(toWorld({ x: 100, y: GROUND_Y, facing: -1 }, r)).toEqual({ x: 40, y: GROUND_Y - 100, w: 50, h: 20 });
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('has no hitbox during startup, an active hitbox on the startup frame, none in recovery', () => {
    const s = fightState('joshua', 'joshua', [300, 800]);
    const lp = getCharacter('joshua').moves.lp;
    stepMatch(s, [Btn.LP, 0]);
    const seen: boolean[] = [!!activeHitbox(s.fighters[0])];
    for (let i = 1; i < lp.startup + lp.active + lp.recovery; i++) {
      stepMatch(s, [0, 0]);
      seen.push(!!activeHitbox(s.fighters[0]));
    }
    // seen[i] reflects the move frame (i+1).
    const firstActive = seen.indexOf(true) + 1;
    expect(firstActive).toBe(lp.startup);
    expect(seen.filter(Boolean).length).toBe(lp.active);
    expect(s.fighters[0].action).toBe('idle');
  });

  it('deals damage exactly once per single-hit attack', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const lp = getCharacter('joshua').moves.lp;
    const max = s.fighters[1].health;
    const ev = tap(s, 0, Btn.LP, 30);
    expect(hits(ev)).toHaveLength(1);
    expect(s.fighters[1].health).toBe(max - lp.damage);
  });

  it('whiffs when out of range', () => {
    const s = fightState('joshua', 'joshua', [300, 600]);
    const ev = tap(s, 0, Btn.LP, 30);
    expect(hits(ev)).toHaveLength(0);
    expect(s.fighters[1].health).toBe(s.fighters[1].maxHealth);
  });

  it('delivers every hit of a configured multi-hit move', () => {
    const s = fightState('koala', 'joshua', [400, 470]);
    const sp = getCharacter('koala').moves.special;
    const ev = tap(s, 0, Btn.SP, 80);
    expect(hits(ev)).toHaveLength(sp.hits!);
  });

  it('spawns projectiles that travel and hit at range', () => {
    const s = fightState('joshua', 'jeremy', [200, 600]);
    const ev = tap(s, 0, Btn.SP, 120);
    expect(ev.some((e) => e.type === 'projectile')).toBe(true);
    const h = hits(ev);
    expect(h).toHaveLength(1);
    expect(h[0].type === 'hit' && h[0].projectile).toBe(true);
    expect(s.projectiles).toHaveLength(0);
  });

  it('cancels opposing projectiles', () => {
    const s = fightState('joshua', 'max-sanchez', [200, 760]);
    stepMatch(s, [Btn.SP, Btn.SP]);
    const ev = run(s, 120);
    expect(ev.some((e) => e.type === 'clash')).toBe(true);
    expect(hits(ev)).toHaveLength(0);
  });

  it('resolves simultaneous hits as a trade', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const ev = tap(s, 0, Btn.LP, 20, [0, 0]);
    void ev;
    const s2 = fightState('joshua', 'joshua', [400, 470]);
    stepMatch(s2, [Btn.LP, Btn.LP]);
    const ev2 = run(s2, 20);
    const h = hits(ev2);
    expect(h).toHaveLength(2);
    expect(new Set(h.map((e) => (e.type === 'hit' ? e.attacker : -1)))).toEqual(new Set([0, 1]));
    expect(s2.fighters[0].health).toBe(s2.fighters[1].health);
  });
});

describe('blocking', () => {
  it('holding back blocks a mid attack, taking chip only, entering blockstun', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const hp = getCharacter('joshua').moves.hp;
    const max = s.fighters[1].health;
    stepMatch(s, [Btn.HP, Btn.RIGHT]);
    const ev = until(s, (st) => st.fighters[1].action === 'blockstun', 30, [0, Btn.RIGHT]);
    void ev;
    expect(s.fighters[1].action).toBe('blockstun');
    expect(s.fighters[1].health).toBe(max - hp.chip);
  });

  it('low attacks must be blocked crouching', () => {
    const standing = fightState('joshua', 'joshua', [400, 470]);
    const ev1 = tap(standing, 0, Btn.DOWN | Btn.LK, 20, [0, Btn.RIGHT]);
    expect(hits(ev1)).toHaveLength(1);
    const crouching = fightState('joshua', 'joshua', [400, 470]);
    const ev2 = tap(crouching, 0, Btn.DOWN | Btn.LK, 20, [0, Btn.RIGHT | Btn.DOWN]);
    expect(hits(ev2)).toHaveLength(0);
    expect(ev2.some((e) => e.type === 'block')).toBe(true);
  });

  it('overheads must be blocked standing', () => {
    const s = fightState('rick', 'joshua', [400, 470]);
    // Rick's heavy kick is an overhead bat swing.
    const ev = tap(s, 0, Btn.HK, 30, [0, Btn.RIGHT | Btn.DOWN]);
    expect(hits(ev)).toHaveLength(1);
    const s2 = fightState('rick', 'joshua', [400, 470]);
    const ev2 = tap(s2, 0, Btn.HK, 30, [0, Btn.RIGHT]);
    expect(hits(ev2)).toHaveLength(0);
  });
});

describe('hit-stun, knockdown and combos', () => {
  it('puts the defender in hit-stun for the move hitstun and then recovers', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const lp = getCharacter('joshua').moves.lp;
    until(s, (st) => st.fighters[1].action === 'hitstun', 20, [Btn.LP, 0]);
    expect(s.fighters[1].stun).toBe(lp.hitstun);
    // Hitstop freezes both fighters first, then stun counts down.
    run(s, lp.hitstun + 12);
    expect(s.fighters[1].action).toBe('idle');
  });

  it('pushes the defender back on hit', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    tap(s, 0, Btn.HP, 30);
    expect(s.fighters[1].x).toBeGreaterThan(480);
  });

  it('knockdown moves floor the opponent, who then gets up invulnerable', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const ev = tap(s, 0, Btn.DOWN | Btn.HK, 40);
    expect(ev.some((e) => e.type === 'knockdown')).toBe(true);
    expect(['knockdown', 'getup']).toContain(s.fighters[1].action);
    expect(hurtboxes(s.fighters[1])).toHaveLength(0);
    until(s, (st) => st.fighters[1].action === 'idle', 120);
  });

  it('chains a cancel combo and applies damage scaling', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    const moves = getCharacter('joshua').moves;
    const max = s.fighters[1].health;
    // LP -> HP -> special (fireball point blank), each pressed as soon as the previous connects.
    stepMatch(s, [Btn.LP, 0]);
    until(s, (st) => st.fighters[0].connected, 20);
    stepMatch(s, [Btn.HP, 0]);
    until(s, (st) => st.fighters[0].move === 'hp' && st.fighters[0].connected, 30);
    stepMatch(s, [Btn.SP, 0]);
    until(s, (st) => st.fighters[1].comboHits >= 3, 60);
    expect(s.fighters[1].comboHits).toBe(3);
    const expected =
      Math.round(moves.lp.damage * COMBO_SCALING[0]) +
      Math.round(moves.hp.damage * COMBO_SCALING[1]) +
      Math.round(moves.special.projectile!.damage * COMBO_SCALING[2]);
    expect(max - s.fighters[1].health).toBe(expected);
    expect(s.bestCombo[0]).toBe(3);
  });

  it('resets the combo counter once the defender recovers', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    tap(s, 0, Btn.LP, 60);
    expect(s.fighters[1].comboHits).toBe(0);
  });

  it('an attack pressed during a forward dash is not dropped (dash attack)', () => {
    const s = fightState('joshua', 'joshua', [300, 800]);
    stepMatch(s, [Btn.RIGHT, 0]);
    stepMatch(s, [0, 0]);
    stepMatch(s, [Btn.RIGHT, 0]);
    expect(s.fighters[0].action).toBe('dash');
    run(s, 2, [Btn.RIGHT, 0]);
    stepMatch(s, [Btn.RIGHT | Btn.HP, 0]);
    run(s, 3, [Btn.RIGHT, 0]);
    expect(s.fighters[0].action).toBe('attack');
    expect(s.fighters[0].move).toBe('hp');
  });

  it('buffers an attack pressed shortly before recovery ends', () => {
    const s = fightState('joshua', 'joshua', [300, 800]);
    const hk = getCharacter('joshua').moves.hk;
    const total = hk.startup + hk.active + hk.recovery;
    stepMatch(s, [Btn.HK, 0]);
    run(s, total - 5);
    stepMatch(s, [Btn.LP, 0]); // pressed during recovery
    run(s, 4);
    expect(s.fighters[0].action).toBe('attack');
    expect(s.fighters[0].move).toBe('lp');
  });
});

describe('super meter', () => {
  it('builds meter on hit and block', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    tap(s, 0, Btn.HP, 30);
    expect(s.fighters[0].meter).toBeGreaterThan(0);
    expect(s.fighters[1].meter).toBeGreaterThan(0);
  });

  it('requires a full meter and consumes it', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    tap(s, 0, Btn.SU, 2);
    expect(s.fighters[0].move).not.toBe('super');
    run(s, 30);
    s.fighters[0].meter = METER_MAX;
    const ev = tap(s, 0, Btn.SU, 1);
    expect(ev.some((e) => e.type === 'super')).toBe(true);
    expect(s.fighters[0].move).toBe('super');
    expect(s.fighters[0].meter).toBe(0);
    const ev2 = run(s, 140);
    expect(hits(ev2).length).toBeGreaterThanOrEqual(3);
  });
});

describe('rounds and match results', () => {
  it('ends the round on KO and starts the next round', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    s.fighters[1].health = 10;
    const ev = tap(s, 0, Btn.HP, 12);
    expect(ev.some((e) => e.type === 'ko')).toBe(true);
    expect(s.phase).toBe('roundEnd');
    expect(s.wins).toEqual([1, 0]);
    expect(s.lastRound).toMatchObject({ winner: 0, reason: 'ko' });
    run(s, ROUND_END_FRAMES + 2);
    expect(s.phase).toBe('intro');
    expect(s.round).toBe(2);
    expect(s.fighters[1].health).toBe(s.fighters[1].maxHealth);
  });

  it('decides a timeout by remaining health percentage', () => {
    const s = fightState('joshua', 'jeremy', [300, 700]);
    s.fighters[0].health = 500;
    s.fighters[1].health = 400;
    s.timer = 2;
    const ev = run(s, 3);
    expect(ev.some((e) => e.type === 'timeUp')).toBe(true);
    expect(s.lastRound).toMatchObject({ winner: 0, reason: 'timeout' });
  });

  it('counts the timer down once per second of frames', () => {
    const s = fightState();
    const t0 = timerSeconds(s);
    run(s, 60);
    expect(timerSeconds(s)).toBe(t0 - 1);
  });

  it('declares the match winner after two round wins', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    s.wins = [1, 0];
    s.fighters[1].health = 5;
    tap(s, 0, Btn.HP, 12);
    expect(s.wins).toEqual([2, 0]);
    const ev = run(s, ROUND_END_FRAMES + 2);
    expect(ev.some((e) => e.type === 'matchEnd')).toBe(true);
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).toBe(0);
  });

  it('a double KO awards no round', () => {
    const s = fightState('joshua', 'joshua', [400, 470]);
    s.fighters[0].health = 5;
    s.fighters[1].health = 5;
    stepMatch(s, [Btn.LP, Btn.LP]);
    const ev = run(s, 10);
    expect(ev.some((e) => e.type === 'ko' && e.loser === 'both')).toBe(true);
    expect(s.wins).toEqual([0, 0]);
    expect(s.lastRound?.winner).toBe('draw');
  });
});
