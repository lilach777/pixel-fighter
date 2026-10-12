import { GROUND_Y } from '../../shared/src/constants';
import { stepMatch, type GameEvent } from '../../shared/src/engine/sim';
import { createMatch, type MatchState } from '../../shared/src/engine/state';

/** Creates a match that is already in the fight phase with fighters at given x positions. */
export function fightState(p1 = 'joshua', p2 = 'joshua', x: [number, number] = [400, 520]): MatchState {
  const s = createMatch(p1, p2);
  s.phase = 'fight';
  s.phaseFrame = 0;
  for (const [i, f] of s.fighters.entries()) {
    f.action = 'idle';
    f.actionFrame = 0;
    f.x = x[i];
    f.y = GROUND_Y;
    f.facing = i === 0 ? 1 : -1;
  }
  return s;
}

/** Steps `n` frames with constant inputs, collecting events. */
export function run(s: MatchState, n: number, inputs: [number, number] = [0, 0]): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...stepMatch(s, inputs));
  return all;
}

/** Presses a button for one frame then releases, then runs `after` frames. */
export function tap(s: MatchState, slot: 0 | 1, bits: number, after = 0, held: [number, number] = [0, 0]): GameEvent[] {
  const inputs: [number, number] = [...held];
  inputs[slot] |= bits;
  const ev = stepMatch(s, inputs);
  return ev.concat(run(s, after, held));
}

/** Runs frames until the predicate holds (or throws after `max`). */
export function until(s: MatchState, pred: (s: MatchState) => boolean, max = 600, inputs: [number, number] = [0, 0]): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < max; i++) {
    if (pred(s)) return all;
    all.push(...stepMatch(s, inputs));
  }
  throw new Error('condition not reached');
}
