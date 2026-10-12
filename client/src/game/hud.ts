import { INTRO_FRAMES, METER_MAX, TICK_RATE } from '../../../shared/src/constants';
import { getCharacter } from '../../../shared/src/characters/roster';
import type { GameEvent } from '../../../shared/src/engine/sim';
import type { Slot } from '../../../shared/src/engine/state';
import type { NetState } from '../../../shared/src/protocol';

export interface HudSide {
  name: string;
  char: string;
  health: number;
  maxHealth: number;
  meter: number;
  superReady: boolean;
  wins: number;
  combo: number;
}

export interface HudData {
  sides: [HudSide, HudSide];
  timer: number;
  round: number;
  roundsToWin: number;
  phase: NetState['phase'];
  banner: string | null;
  subBanner: string | null;
  superBanner: { name: string; slot: Slot } | null;
  matchWinner: Slot | 'draw' | null;
  status: string;
  bestCombo: [number, number];
}

/** Tracks combo counters from hit events so they stay on screen briefly after a combo ends. */
export class ComboTracker {
  private shown: [{ count: number; until: number }, { count: number; until: number }] = [
    { count: 0, until: 0 },
    { count: 0, until: 0 },
  ];
  handle(events: GameEvent[], frame: number): void {
    for (const e of events) {
      if (e.type === 'hit' && e.combo >= 2) this.shown[e.attacker] = { count: e.combo, until: frame + 70 };
      if (e.type === 'roundStart') this.shown = [{ count: 0, until: 0 }, { count: 0, until: 0 }];
    }
  }
  get(slot: Slot, frame: number): number {
    return this.shown[slot].until > frame ? this.shown[slot].count : 0;
  }
}

export function deriveHud(state: NetState, names: [string, string], combos: ComboTracker): HudData {
  const [a, b] = state.fighters;
  const side = (i: Slot): HudSide => {
    const f = state.fighters[i];
    return {
      name: names[i],
      char: f.char,
      health: f.health,
      maxHealth: f.maxHealth,
      meter: f.meter,
      superReady: f.meter >= METER_MAX,
      wins: state.wins[i],
      combo: combos.get(i, state.frame),
    };
  };
  let banner: string | null = null;
  let subBanner: string | null = null;
  const finalRound = state.wins[0] === state.config.roundsToWin - 1 && state.wins[1] === state.config.roundsToWin - 1;
  if (state.phase === 'intro') {
    banner = state.phaseFrame < INTRO_FRAMES - 30 ? (finalRound ? 'FINAL ROUND' : `ROUND ${state.round}`) : 'FIGHT!';
  } else if (state.phase === 'fight' && state.phaseFrame < 30) {
    banner = 'FIGHT!';
  } else if (state.phase === 'roundEnd' && state.lastRound) {
    const lr = state.lastRound;
    if (state.phaseFrame < 80) {
      banner = lr.reason === 'timeout' ? 'TIME UP' : lr.reason === 'doubleKo' ? 'DOUBLE K.O.' : 'K.O.';
    } else {
      banner = lr.winner === 'draw' ? 'DRAW' : `${names[lr.winner].toUpperCase()} WINS`;
      if (lr.perfect) subBanner = 'PERFECT';
    }
  }
  const superBanner =
    state.superFreeze > 0 && state.superOwner !== -1
      ? { name: getCharacter(state.fighters[state.superOwner].char).superName, slot: state.superOwner }
      : null;
  let status = '';
  if (state.phase === 'intro') status = `Round ${state.round}`;
  else if (state.phase === 'fight') status = `Round ${state.round} — Fight`;
  else if (state.phase === 'roundEnd') status = `Round ${state.round} over`;
  else if (state.phase === 'matchEnd') status = state.matchWinner === 'draw' ? 'Match drawn' : `${names[state.matchWinner as Slot]} wins the match`;
  void a;
  void b;
  return {
    sides: [side(0), side(1)],
    timer: Math.ceil(state.timer / TICK_RATE),
    round: state.round,
    roundsToWin: state.config.roundsToWin,
    phase: state.phase,
    banner,
    subBanner,
    superBanner,
    matchWinner: state.matchWinner,
    status,
    bestCombo: state.bestCombo,
  };
}

/** Minimal external store for React (useSyncExternalStore). */
export class HudStore {
  private data: HudData | null = null;
  private subs = new Set<() => void>();
  set(d: HudData): void {
    this.data = d;
    for (const s of this.subs) s();
  }
  get = (): HudData | null => this.data;
  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  };
}
