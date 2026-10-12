import { getCharacter } from '../../../../shared/src/characters/roster';
import { GROUND_Y, METER_MAX, STAGE_LEFT, STAGE_RIGHT } from '../../../../shared/src/constants';
import type { MatchState, Slot } from '../../../../shared/src/engine/state';
import { Btn } from '../../../../shared/src/input';
import { Rng } from '../../../../shared/src/rng';

/**
 * Choreographs the title-screen fight. It produces input bitmasks for a PRIVATE demo match
 * that runs on the real engine, so every hit, block, knockback and effect is a genuine
 * engine result. It never touches any gameplay state.
 *
 * A script is a list of steps. Keys are relative to each fighter: F = toward opponent,
 * B = away, U/D = jump/crouch, plus LP HP LK HK SP SU. A step lasts `frames`, or until
 * `until` holds (capped by `frames`).
 */
type Keys = string;
type KeySpec = Keys | ((s: MatchState, who: Slot) => Keys);
interface Step {
  a?: KeySpec;
  d?: KeySpec;
  frames: number;
  until?: (s: MatchState) => boolean;
  /** Runs once when the step starts. */
  enter?: (s: MatchState) => void;
}

export type BeatName = 'faceoff' | 'jabs' | 'kicks' | 'dashPunch' | 'sweep' | 'projectile' | 'antiAir' | 'super' | 'blockString' | 'reset';

const dist = (s: MatchState) => Math.abs(s.fighters[0].x - s.fighters[1].x);
const actionable = (s: MatchState, i: Slot) => {
  const f = s.fighters[i];
  return !f.airborne && (f.action === 'idle' || f.action === 'walk' || f.action === 'walkBack' || f.action === 'crouch');
};
const bothReady = (s: MatchState) => actionable(s, 0) && actionable(s, 1);

export class FightDirector {
  private rng: Rng;
  private steps: Step[] = [];
  private stepFrame = 0;
  private attacker: Slot = 0;
  /** Beats played so far (exposed for tests / debugging). */
  readonly history: BeatName[] = [];
  exchanges = 0;

  constructor(seed = 7) {
    this.rng = new Rng(seed);
  }

  /** Input bits for both fighters this frame. Call once per simulation frame. */
  update(s: MatchState): [number, number] {
    if (!this.steps.length) this.plan(s);
    let step = this.steps[0];
    if (this.stepFrame === 0) step.enter?.(s);
    this.stepFrame++;
    const done = this.stepFrame >= step.frames || (step.until?.(s) ?? false);
    const a = this.attacker;
    const d = (1 - a) as Slot;
    const out: [number, number] = [0, 0];
    const resolve = (k: KeySpec | undefined, who: Slot) => (typeof k === 'function' ? k(s, who) : (k ?? ''));
    out[a] = this.bits(s, a, resolve(step.a, a));
    out[d] = this.bits(s, d, resolve(step.d, d));
    if (done) {
      this.steps.shift();
      this.stepFrame = 0;
      step = this.steps[0];
    }
    return out;
  }

  private bits(s: MatchState, i: Slot, keys: Keys): number {
    if (!keys) return 0;
    const f = s.fighters[i];
    const fwd = f.facing === 1 ? Btn.RIGHT : Btn.LEFT;
    const back = f.facing === 1 ? Btn.LEFT : Btn.RIGHT;
    let b = 0;
    for (const k of keys.split('+')) {
      if (k === 'F') b |= fwd;
      else if (k === 'B') b |= back;
      else if (k === 'U') b |= Btn.UP;
      else if (k === 'D') b |= Btn.DOWN;
      else if (k in Btn) b |= Btn[k as keyof typeof Btn];
    }
    return b;
  }

  /** Steps for pressing a button once (press, release) then holding `after` for n frames. */
  private press(who: 'a' | 'd', keys: Keys, wait: number, other: Keys = ''): Step[] {
    const o = who === 'a' ? 'd' : 'a';
    return [
      { [who]: keys, [o]: other, frames: 2 },
      { [o]: other, frames: wait },
    ];
  }

  private approach(maxDist: number): Step {
    return { a: 'F', frames: 110, until: (s) => dist(s) <= maxDist };
  }

  private waitRecovered(extra = 0): Step[] {
    return [{ frames: 120, until: bothReady }, { frames: extra }];
  }

  private plan(s: MatchState): void {
    // Fighters drifting toward a wall or too close: reset spacing first.
    const [f0, f1] = s.fighters;
    const nearWall = Math.min(f0.x, f1.x) < STAGE_LEFT + 90 || Math.max(f0.x, f1.x) > STAGE_RIGHT - 90;
    if (this.history.length && (nearWall || dist(s) < 105) && this.history[this.history.length - 1] !== 'reset') {
      return this.use('reset', this.reset());
    }
    if (!this.history.length || this.history[this.history.length - 1] !== 'faceoff') {
      return this.use('faceoff', this.faceoff());
    }
    this.attacker = this.rng.chance(0.5) ? 0 : 1;
    this.exchanges++;
    const a = s.fighters[this.attacker];
    const hasProjectile = !!getCharacter(a.char).moves.special.projectile;
    const options: [BeatName, number][] = [
      ['jabs', 3],
      ['kicks', 3],
      ['dashPunch', 2],
      ['sweep', 2],
      ['projectile', hasProjectile ? 2 : 1],
      ['antiAir', 1],
      ['blockString', 2],
      ['super', 1],
    ];
    let r = this.rng.next() * options.reduce((t, [, w]) => t + w, 0);
    let pick: BeatName = 'jabs';
    for (const [name, w] of options) {
      r -= w;
      if (r <= 0) {
        pick = name;
        break;
      }
    }
    this.use(pick, this.beat(pick, hasProjectile));
  }

  private use(name: BeatName, steps: Step[]): void {
    this.history.push(name);
    if (this.history.length > 50) this.history.shift();
    this.steps = steps;
    this.stepFrame = 0;
  }

  private faceoff(): Step[] {
    // Idle stand-off with a little footsie movement: the pause between exchanges.
    const steps: Step[] = [{ frames: this.rng.int(22, 40) }];
    if (this.rng.chance(0.5)) steps.push({ a: 'F', d: this.rng.chance(0.5) ? 'B' : '', frames: this.rng.int(8, 16) }, { frames: this.rng.int(10, 25) });
    return steps;
  }

  private reset(): Step[] {
    // Walk apart until comfortably spaced, then drift back toward the middle of the stage.
    const towardCentre = (st: MatchState, who: Slot): Keys => {
      const mid = (st.fighters[0].x + st.fighters[1].x) / 2;
      return mid < 480 === (st.fighters[who].facing === 1) ? 'F' : 'B';
    };
    const walls = (st: MatchState) => Math.min(st.fighters[0].x, st.fighters[1].x) < STAGE_LEFT + 60 || Math.max(st.fighters[0].x, st.fighters[1].x) > STAGE_RIGHT - 60;
    return [
      { frames: 90, until: bothReady },
      { a: 'B', d: 'B', frames: 70, until: (st) => dist(st) >= 230 || walls(st) },
      { a: towardCentre, d: towardCentre, frames: 60, until: (st) => Math.abs((st.fighters[0].x + st.fighters[1].x) / 2 - 480) < 60 },
    ];
  }

  private beat(name: BeatName, hasProjectile: boolean): Step[] {
    const block = this.rng.chance(0.35) ? 'B' : '';
    switch (name) {
      case 'jabs':
        return [this.approach(95), ...this.press('a', 'LP', 7, block), ...this.press('a', 'LP', 7, block), ...this.press('a', 'HP', 28, block), ...this.waitRecovered(10)];
      case 'kicks':
        return [this.approach(100), ...this.press('a', 'LK', 9, block), ...this.press('a', 'HK', 34, block), ...this.waitRecovered(10)];
      case 'blockString':
        // Defender guards the whole string: block sparks and push-back.
        return [this.approach(95), ...this.press('a', 'LP', 7, 'B'), ...this.press('a', 'LK', 9, 'B'), ...this.press('a', 'HP', 30, 'B'), ...this.waitRecovered(10)];
      case 'dashPunch':
        return [
          { frames: 1 },
          { a: 'F', frames: 2 },
          { frames: 2 },
          { a: 'F', frames: 2 },
          { a: 'F', frames: 30, until: (s) => dist(s) <= 120 },
          ...this.press('a', 'HP', 30),
          ...this.waitRecovered(14),
        ];
      case 'sweep':
        return [this.approach(105), ...this.press('a', 'D+HK', 80), ...this.waitRecovered(10)];
      case 'projectile':
        if (!hasProjectile) return [this.approach(120), ...this.press('a', 'SP', 45), ...this.waitRecovered(12)];
        return [
          { a: 'B', frames: 40, until: (s) => dist(s) >= 300 },
          ...this.press('a', 'SP', 18),
          // Defender sometimes jumps over the projectile.
          this.rng.chance(0.4) ? { d: 'U+F', frames: 4 } : { d: 'B', frames: 4 },
          { d: '', frames: 50 },
          ...this.waitRecovered(12),
        ];
      case 'antiAir':
        return [
          { a: 'B', frames: 40, until: (s) => dist(s) >= 230 },
          { d: 'U+F', frames: 4 },
          { frames: 30, until: (s) => s.fighters[1 - this.attacker].airborne && dist(s) < 170 },
          ...this.press('a', 'D+SP', 50),
          ...this.waitRecovered(14),
        ];
      case 'super':
        return [
          {
            frames: 1,
            enter: (s) => {
              s.fighters[this.attacker].meter = METER_MAX;
            },
          },
          this.approach(140),
          ...this.press('a', 'SU', 140),
          ...this.waitRecovered(20),
        ];
      default:
        return [{ frames: 30 }];
    }
  }
}

/** Keeps the demo match alive forever: no KOs, no timeouts, no round changes. */
export function sustainDemo(s: MatchState): void {
  s.timer = 99 * 60;
  for (const f of s.fighters) {
    if (f.health < f.maxHealth * 0.5) f.health = f.maxHealth;
    if (f.y > GROUND_Y) f.y = GROUND_Y;
  }
}
