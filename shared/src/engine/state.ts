import {
  DEFAULT_ROUNDS_TO_WIN,
  DEFAULT_ROUND_SECONDS,
  GROUND_Y,
  INPUT_BUFFER_FRAMES,
  TICK_RATE,
} from '../constants';
import { getCharacter } from '../characters/roster';
import type { MoveSlot } from '../characters/types';

export type Action =
  | 'intro'
  | 'idle'
  | 'walk'
  | 'walkBack'
  | 'crouch'
  | 'jumpSquat'
  | 'jump'
  | 'land'
  | 'dash'
  | 'backdash'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'knockdown'
  | 'getup'
  | 'victory'
  | 'timeoutLoss';

export type Slot = 0 | 1;

export interface FighterState {
  char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  health: number;
  maxHealth: number;
  meter: number;
  action: Action;
  actionFrame: number;
  move: MoveSlot | null;
  /** Increments every time an attack starts (identifies attack instances). */
  attackId: number;
  /** Hits already delivered by the current attack (multi-hit bookkeeping). */
  hitsDone: number;
  /** Frame index of the most recent hit by the current attack. */
  lastHitFrame: number;
  /** Current attack hit or was blocked: enables cancels. */
  connected: boolean;
  armorUsed: boolean;
  airAttackUsed: boolean;
  stun: number;
  airborne: boolean;
  /** Knockdown sub-state: true once the fighter has landed and is lying down. */
  grounded: boolean;
  invuln: number;
  /** Hits taken in the current combo, and the damage they did. */
  comboHits: number;
  comboDamage: number;
  crouching: boolean;
  blocking: boolean;
  jumpDir: -1 | 0 | 1;
  lastInput: number;
  /** Pressed-edge bitmasks for the last INPUT_BUFFER_FRAMES frames (index 0 = newest). */
  buffer: number[];
  tapDir: number;
  tapAge: number;
  /** Render-only: frames left of the white hit flash. */
  flash: number;
}

/** Fighter fields needed for rendering and box queries (network snapshots omit input state). */
export type FighterView = Omit<FighterState, 'buffer' | 'lastInput' | 'tapDir' | 'tapAge'>;

export interface Projectile {
  id: number;
  owner: Slot;
  char: string;
  slot: MoveSlot;
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  life: number;
  age: number;
  hitsDone: number;
  lastHitAge: number;
  effect: string;
  color: string;
}

export type MatchPhase = 'intro' | 'fight' | 'roundEnd' | 'matchEnd';
export type RoundResultReason = 'ko' | 'timeout' | 'doubleKo' | 'forfeit';

export interface MatchConfig {
  roundSeconds: number;
  roundsToWin: number;
}

export interface RoundResult {
  round: number;
  winner: Slot | 'draw';
  reason: RoundResultReason;
  perfect: boolean;
}

export interface MatchState {
  frame: number;
  phase: MatchPhase;
  phaseFrame: number;
  round: number;
  /** Frames remaining in the round. */
  timer: number;
  wins: [number, number];
  fighters: [FighterState, FighterState];
  projectiles: Projectile[];
  nextProjectileId: number;
  hitstop: number;
  /** Frames of super-flash freeze remaining (only the super's owner keeps animating). */
  superFreeze: number;
  superOwner: Slot | -1;
  config: MatchConfig;
  lastRound: RoundResult | null;
  matchWinner: Slot | 'draw' | null;
  /** Highest combo per player this match (stats for the result screen). */
  bestCombo: [number, number];
}

export const START_X: [number, number] = [330, 630];

export function createFighter(charId: string, slot: Slot): FighterState {
  const def = getCharacter(charId);
  return {
    char: charId,
    x: START_X[slot],
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: slot === 0 ? 1 : -1,
    health: def.stats.maxHealth,
    maxHealth: def.stats.maxHealth,
    meter: 0,
    action: 'intro',
    actionFrame: 0,
    move: null,
    attackId: 0,
    hitsDone: 0,
    lastHitFrame: -1,
    connected: false,
    armorUsed: false,
    airAttackUsed: false,
    stun: 0,
    airborne: false,
    grounded: false,
    invuln: 0,
    comboHits: 0,
    comboDamage: 0,
    crouching: false,
    blocking: false,
    jumpDir: 0,
    lastInput: 0,
    buffer: new Array(INPUT_BUFFER_FRAMES).fill(0),
    tapDir: 0,
    tapAge: 99,
    flash: 0,
  };
}

export function createMatch(p1: string, p2: string, config: Partial<MatchConfig> = {}): MatchState {
  const cfg: MatchConfig = {
    roundSeconds: config.roundSeconds ?? DEFAULT_ROUND_SECONDS,
    roundsToWin: config.roundsToWin ?? DEFAULT_ROUNDS_TO_WIN,
  };
  return {
    frame: 0,
    phase: 'intro',
    phaseFrame: 0,
    round: 1,
    timer: cfg.roundSeconds * TICK_RATE,
    wins: [0, 0],
    fighters: [createFighter(p1, 0), createFighter(p2, 1)],
    projectiles: [],
    nextProjectileId: 1,
    hitstop: 0,
    superFreeze: 0,
    superOwner: -1,
    config: cfg,
    lastRound: null,
    matchWinner: null,
    bestCombo: [0, 0],
  };
}

/** Seconds shown on the HUD clock. */
export function timerSeconds(state: MatchState): number {
  return Math.ceil(state.timer / TICK_RATE);
}

export function cloneMatch(state: MatchState): MatchState {
  return structuredClone(state);
}
