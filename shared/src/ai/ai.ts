import { getCharacter } from '../characters/roster';
import type { MoveDef, MoveSlot } from '../characters/types';
import { activeHitbox, currentMove, movePhase } from '../engine/boxes';
import type { FighterState, MatchState, Slot } from '../engine/state';
import { Btn } from '../input';
import { Rng } from '../rng';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AIProfile {
  /** Frames before the AI perceives what the opponent did. */
  reactionFrames: number;
  /** Probability per decision to press an attack when in range. */
  aggression: number;
  blockChance: number;
  antiAirChance: number;
  punishChance: number;
  comboChance: number;
  /** Probability of a random wrong decision. */
  mistakeRate: number;
  jumpChance: number;
  /** Frames between neutral decisions. */
  thinkInterval: number;
}

export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { reactionFrames: 26, aggression: 0.22, blockChance: 0.25, antiAirChance: 0.15, punishChance: 0.2, comboChance: 0.15, mistakeRate: 0.3, jumpChance: 0.08, thinkInterval: 16 },
  normal: { reactionFrames: 15, aggression: 0.42, blockChance: 0.55, antiAirChance: 0.45, punishChance: 0.55, comboChance: 0.5, mistakeRate: 0.12, jumpChance: 0.1, thinkInterval: 10 },
  hard: { reactionFrames: 6, aggression: 0.6, blockChance: 0.85, antiAirChance: 0.8, punishChance: 0.85, comboChance: 0.85, mistakeRate: 0.03, jumpChance: 0.12, thinkInterval: 6 },
};

interface Observation {
  action: FighterState['action'];
  move: MoveSlot | null;
  phase: 'startup' | 'active' | 'recovery' | null;
  level: MoveDef['level'] | null;
  x: number;
  airborne: boolean;
  vx: number;
  threatReach: number;
  projectileDist: number;
}

interface PlanStep {
  bits: number;
  frames: number;
}

/** Decision label of the most recent choice (exposed for tests and debugging). */
export type AIIntent = 'idle' | 'approach' | 'retreat' | 'dash' | 'jumpIn' | 'block' | 'antiAir' | 'punish' | 'poke' | 'zone' | 'combo' | 'super' | 'jumpProjectile' | 'mistake';

export class AIController {
  readonly profile: AIProfile;
  private rng: Rng;
  private observations: Observation[] = [];
  private plan: PlanStep[] = [];
  private cooldown = 0;
  private idleFrames = 0;
  lastIntent: AIIntent = 'idle';
  readonly intents: Partial<Record<AIIntent, number>> = {};

  constructor(
    readonly slot: Slot,
    readonly difficulty: Difficulty,
    seed = 1234,
  ) {
    this.profile = AI_PROFILES[difficulty];
    this.rng = new Rng(seed);
  }

  reset(): void {
    this.observations = [];
    this.plan = [];
    this.cooldown = 0;
    this.idleFrames = 0;
  }

  /** Returns this frame's input bits. Call once per simulation frame. */
  update(state: MatchState): number {
    const me = state.fighters[this.slot];
    const opp = state.fighters[1 - this.slot];
    this.observe(state, opp);
    if (state.phase !== 'fight') {
      this.plan = [];
      return 0;
    }
    const seen = this.perceived();
    const fwd = me.facing === 1 ? Btn.RIGHT : Btn.LEFT;
    const back = me.facing === 1 ? Btn.LEFT : Btn.RIGHT;
    const dist = Math.abs(opp.x - me.x);

    // Already committed: hold through blockstun, try to combo out of a connected attack.
    if (me.action === 'blockstun') {
      return back | (me.crouching ? Btn.DOWN : 0);
    }
    if (me.action === 'attack') {
      const m = currentMove(me)!;
      if (me.connected && m.cancelWindow && m.cancelInto && me.actionFrame >= m.cancelWindow[0] && me.actionFrame <= m.cancelWindow[1]) {
        if (this.cooldown <= 0 && this.rng.chance(this.profile.comboChance)) {
          this.cooldown = 4;
          const bits = this.comboFollowUp(me, m);
          if (bits) {
            this.mark('combo');
            return bits;
          }
        }
      }
      this.cooldown--;
      return 0;
    }

    // Reactive layer (uses delayed perception).
    if (seen && this.isActionable(me)) {
      const reactive = this.react(me, opp, seen, dist, fwd, back);
      if (reactive !== null) return reactive;
    }

    // Continue an existing plan.
    if (this.plan.length) return this.consumePlan();

    if (!this.isActionable(me)) return 0;
    this.cooldown--;
    if (this.cooldown > 0 && this.idleFrames < 40) {
      this.idleFrames++;
      return 0;
    }
    this.cooldown = this.profile.thinkInterval + this.rng.int(0, 6);
    this.neutral(state, me, opp, dist, fwd, back);
    return this.plan.length ? this.consumePlan() : 0;
  }

  private mark(intent: AIIntent): void {
    this.lastIntent = intent;
    this.intents[intent] = (this.intents[intent] ?? 0) + 1;
    if (intent !== 'idle') this.idleFrames = 0;
  }

  private isActionable(f: FighterState): boolean {
    return (f.action === 'idle' || f.action === 'walk' || f.action === 'walkBack' || f.action === 'crouch') && !f.airborne;
  }

  private observe(state: MatchState, opp: FighterState): void {
    const m = currentMove(opp);
    const hb = activeHitbox(opp);
    const proj = state.projectiles.filter((p) => p.owner !== this.slot);
    const me = state.fighters[this.slot];
    const projectileDist = proj.length
      ? Math.min(...proj.filter((p) => Math.sign(me.x - p.x) === Math.sign(p.vx)).map((p) => Math.abs(p.x - me.x)), 9999)
      : 9999;
    this.observations.push({
      action: opp.action,
      move: opp.move,
      phase: m ? movePhase(m, opp.actionFrame) : null,
      level: m?.level ?? null,
      x: opp.x,
      airborne: opp.airborne,
      vx: opp.vx,
      threatReach: m ? m.hitbox.x + m.hitbox.w + (m.advance ?? 0) * (m.startup + m.active) : hb ? 100 : 0,
      projectileDist,
    });
    if (this.observations.length > 64) this.observations.shift();
  }

  private perceived(): Observation | null {
    const i = this.observations.length - 1 - this.profile.reactionFrames;
    return i >= 0 ? this.observations[i] : null;
  }

  private reach(f: FighterState, slot: MoveSlot): number {
    const m = getCharacter(f.char).moves[slot];
    if (m.projectile) return 2000;
    return m.hitbox.x + m.hitbox.w + (m.advance ?? 0) * (m.startup + m.active);
  }

  private hasProjectile(f: FighterState, slot: MoveSlot = 'special'): boolean {
    return !!getCharacter(f.char).moves[slot].projectile;
  }

  private isAntiAir(f: FighterState): boolean {
    const m = getCharacter(f.char).moves.specialAlt;
    return !!(m.rise && m.invuln);
  }

  private react(me: FighterState, opp: FighterState, seen: Observation, dist: number, fwd: number, back: number): number | null {
    const p = this.profile;
    // Incoming projectile: block or jump over it.
    if (seen.projectileDist < 230) {
      if (this.rng.chance(p.jumpChance * 3)) {
        this.mark('jumpProjectile');
        this.plan = [{ bits: Btn.UP | fwd, frames: 4 }];
        return this.consumePlan();
      }
      if (this.rng.chance(p.blockChance)) {
        this.mark('block');
        this.plan = [{ bits: back, frames: 16 }];
        return this.consumePlan();
      }
    }
    // Attack coming: block (crouch for lows, stand for overheads).
    const threatened = seen.action === 'attack' && seen.phase !== 'recovery' && dist < seen.threatReach + 40;
    if (threatened && this.rng.chance(p.blockChance)) {
      if (this.rng.chance(p.mistakeRate)) {
        this.mark('mistake');
        return 0;
      }
      const low = seen.level === 'low' || (seen.level !== 'overhead' && this.rng.chance(0.35));
      this.mark('block');
      this.plan = [{ bits: back | (low ? Btn.DOWN : 0), frames: 14 }];
      return this.consumePlan();
    }
    // Jumping opponent closing in: anti-air.
    if (seen.airborne && seen.action !== 'knockdown' && dist < 170 && this.rng.chance(p.antiAirChance)) {
      this.mark('antiAir');
      this.plan = this.isAntiAir(me) ? [{ bits: Btn.DOWN | Btn.SP, frames: 1 }] : [{ bits: Btn.HP, frames: 1 }];
      return this.consumePlan();
    }
    // Opponent recovering from a whiffed attack: punish.
    if (seen.action === 'attack' && seen.phase === 'recovery' && !opp.connected && this.rng.chance(p.punishChance)) {
      if (me.meter >= 100 && dist < 160) {
        this.mark('super');
        this.plan = [{ bits: Btn.SU, frames: 1 }];
        return this.consumePlan();
      }
      if (dist < this.reach(me, 'hk')) {
        this.mark('punish');
        this.plan = [{ bits: Btn.HK, frames: 1 }];
        return this.consumePlan();
      }
      if (dist < this.reach(me, 'special') + 30) {
        this.mark('punish');
        this.plan = [{ bits: Btn.SP, frames: 1 }];
        return this.consumePlan();
      }
    }
    return null;
  }

  private comboFollowUp(me: FighterState, m: MoveDef): number {
    const into = m.cancelInto ?? [];
    if (into.includes('super') && me.meter >= 100 && this.rng.chance(0.5)) return Btn.SU;
    if (into.includes('heavy') && this.rng.chance(0.55)) return this.rng.chance(0.5) ? Btn.HP : Btn.HK;
    if (into.includes('special') && !this.hasProjectile(me)) return Btn.SP;
    if (into.includes('special')) return this.rng.chance(0.6) ? Btn.SP : Btn.DOWN | Btn.SP;
    if (into.includes('normal')) return Btn.LP;
    return 0;
  }

  private neutral(state: MatchState, me: FighterState, opp: FighterState, dist: number, fwd: number, back: number): void {
    const p = this.profile;
    if (this.rng.chance(p.mistakeRate * 0.5)) {
      this.mark('mistake');
      this.plan = [{ bits: this.rng.pick([0, back, Btn.DOWN, Btn.UP]), frames: this.rng.int(6, 16) }];
      return;
    }
    if (me.meter >= 100 && dist < this.reach(me, 'super') + 10 && this.rng.chance(p.aggression)) {
      this.mark('super');
      this.plan = [{ bits: Btn.SU, frames: 1 }];
      return;
    }
    const closeReach = Math.max(this.reach(me, 'lp'), this.reach(me, 'lk'));
    const forceAct = this.idleFrames > 45;
    // Proactive guard: inside the opponent's reach, good players hold back instead of
    // waiting to see the attack (fast jabs are quicker than any reaction).
    if (!forceAct && dist < this.reach(opp, 'hk') + 10 && this.rng.chance(p.blockChance * 0.45)) {
      this.mark('block');
      this.plan = [{ bits: back | (this.rng.chance(0.4) ? Btn.DOWN : 0), frames: this.rng.int(8, 16) }];
      return;
    }
    if (dist <= closeReach + 6) {
      if (this.rng.chance(p.aggression) || forceAct) {
        this.mark('poke');
        const options: [number, number][] = [
          [Btn.LP, 3],
          [Btn.LK, 2],
          [Btn.DOWN | Btn.LK, 2],
          [Btn.HP, 2],
          [Btn.HK, 1],
          [Btn.DOWN | Btn.HK, 1],
        ];
        this.plan = [{ bits: this.weighted(options), frames: 1 }];
        return;
      }
      if (this.rng.chance(0.3)) {
        this.mark('retreat');
        this.plan = [{ bits: back, frames: this.rng.int(8, 18) }];
        return;
      }
      this.mark('block');
      this.plan = [{ bits: back | (this.rng.chance(0.5) ? Btn.DOWN : 0), frames: 10 }];
      return;
    }
    if (dist <= this.reach(me, 'hk') + 4 && (this.rng.chance(p.aggression) || forceAct)) {
      this.mark('poke');
      this.plan = [{ bits: this.rng.chance(0.6) ? Btn.HK : Btn.HP, frames: 1 }];
      return;
    }
    const zoner = this.hasProjectile(me);
    const ownProjectile = state.projectiles.some((q) => q.owner === this.slot);
    if (zoner && dist > 220 && !ownProjectile && this.rng.chance(0.35 + p.aggression * 0.4)) {
      this.mark('zone');
      this.plan = [{ bits: Btn.SP, frames: 1 }];
      return;
    }
    if (!zoner && dist < this.reach(me, 'special') && dist > 120 && this.rng.chance(p.aggression * 0.6)) {
      this.mark('poke');
      this.plan = [{ bits: Btn.SP, frames: 1 }];
      return;
    }
    if (dist > 200 && dist < 330 && !opp.airborne && this.rng.chance(p.jumpChance)) {
      this.mark('jumpIn');
      this.plan = [
        { bits: Btn.UP | fwd, frames: 3 },
        { bits: fwd, frames: 16 },
        { bits: Btn.HK, frames: 1 },
        { bits: 0, frames: 2 },
      ];
      return;
    }
    if (dist > 300 && this.rng.chance(0.25)) {
      this.mark('dash');
      this.plan = [
        { bits: fwd, frames: 1 },
        { bits: 0, frames: 1 },
        { bits: fwd, frames: 1 },
        { bits: 0, frames: 10 },
      ];
      return;
    }
    if (dist < 140 && this.rng.chance(0.15)) {
      this.mark('retreat');
      this.plan = [{ bits: back, frames: this.rng.int(10, 20) }];
      return;
    }
    this.mark('approach');
    this.plan = [{ bits: fwd, frames: this.rng.int(10, 26) }];
  }

  private weighted(options: [number, number][]): number {
    const total = options.reduce((a, [, w]) => a + w, 0);
    let r = this.rng.next() * total;
    for (const [bits, w] of options) {
      r -= w;
      if (r <= 0) return bits;
    }
    return options[0][0];
  }

  private consumePlan(): number {
    const step = this.plan[0];
    if (!step) return 0;
    step.frames--;
    if (step.frames <= 0) this.plan.shift();
    return step.bits;
  }
}
