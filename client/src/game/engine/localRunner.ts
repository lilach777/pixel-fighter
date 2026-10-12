import { AIController, type Difficulty } from '../../../../shared/src/ai/ai';
import { TICK_MS } from '../../../../shared/src/constants';
import { getCharacter } from '../../../../shared/src/characters/roster';
import { stepMatch } from '../../../../shared/src/engine/sim';
import { createMatch, type MatchState } from '../../../../shared/src/engine/state';
import { getSettings } from '../../settings';
import { audio } from '../audio/audio';
import { loadCharacterSprites } from '../animation/sprites';
import { ComboTracker, HudStore, deriveHud } from '../hud';
import { allCodes, bitsFromKeys } from '../input/bindings';
import { KeyboardState } from '../input/keyboard';
import { Renderer } from '../rendering/renderer';
import { blendPositions, capturePositions, type PositionSnapshot } from './interpolation';

export interface LocalMatchOptions {
  mode: 'cpu' | 'local';
  p1: string;
  p2: string;
  difficulty: Difficulty;
  stage: string;
  roundSeconds: number;
  roundsToWin: number;
}

const SPRITE_HEIGHT = 168;

export type ControllerType = 'keyboard-p1' | 'keyboard-p2' | 'ai' | 'remote';

/**
 * Runs an offline match: fixed 60 Hz simulation steps driven by requestAnimationFrame
 * with an accumulator (simulation speed is independent of the display refresh rate).
 */
export class LocalRunner {
  readonly hud = new HudStore();
  state: MatchState;
  paused = false;
  renderer: Renderer | null = null;
  /** Created on attach, disposed on detach (React StrictMode mounts effects twice in dev). */
  private keyboard: KeyboardState | null = null;
  private ai: AIController | null;
  private combos = new ComboTracker();
  private raf = 0;
  private last = 0;
  private acc = 0;
  /** Positions before the latest simulation step (for render interpolation). */
  private prevPositions: PositionSnapshot | null = null;
  private names: [string, string];
  onMatchEnd: (() => void) | null = null;
  /** Development diagnostics (shown by the debug panel). */
  readonly debug = { loopRunning: false, steps: 0, lastInput: [0, 0] as [number, number], lastHit: null as null | { frame: number; attacker: number; damage: number } };

  /** Who drives each fighter: P1 is always the local keyboard; P2 is the AI (CPU mode) or the second keyboard player. */
  readonly controllers: [ControllerType, ControllerType];

  constructor(readonly opts: LocalMatchOptions) {
    if (opts.mode === 'cpu' && opts.p1 === opts.p2) throw new Error('Single-player opponent must differ from the player character');
    this.state = this.newState();
    // Opponent selection already happened; AI initialisation is a separate step and only for CPU mode.
    this.ai = opts.mode === 'cpu' ? new AIController(1, opts.difficulty, Date.now() & 0xffff) : null;
    if (opts.mode === 'cpu' && !this.ai) throw new Error('AI controller failed to initialise');
    this.controllers = ['keyboard-p1', this.ai ? 'ai' : 'keyboard-p2'];
    const n1 = getCharacter(opts.p1).name;
    const n2 = getCharacter(opts.p2).name;
    this.names = [n1, n2];
    this.publish();
  }

  private newState(): MatchState {
    return createMatch(this.opts.p1, this.opts.p2, { roundSeconds: this.opts.roundSeconds, roundsToWin: this.opts.roundsToWin });
  }

  attach(canvas: HTMLCanvasElement): void {
    // Idempotent: never run two loops or two sets of key listeners.
    if (this.keyboard) this.detach();
    const s = getSettings();
    this.keyboard = new KeyboardState();
    this.keyboard.capture(allCodes(s.p1, s.p2));
    this.renderer = new Renderer(canvas, this.opts.stage);
    void Promise.all([loadCharacterSprites(this.opts.p1, SPRITE_HEIGHT), loadCharacterSprites(this.opts.p2, SPRITE_HEIGHT)])
      .then((s) => this.renderer?.setSprites(s))
      .catch((e) => console.error(e));
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.loop);
    this.debug.loopRunning = true;
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.keyboard?.dispose();
    this.keyboard = null;
    this.renderer = null;
    this.debug.loopRunning = false;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.last = performance.now();
    this.acc = 0;
  }

  restart(): void {
    this.state = this.newState();
    this.prevPositions = null;
    this.ai?.reset();
    this.combos = new ComboTracker();
    this.paused = false;
    this.publish();
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.paused) {
      this.acc += Math.min(250, now - this.last);
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 5) {
        this.prevPositions = capturePositions(this.state);
        this.step();
        this.acc -= TICK_MS;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    this.last = now;
    // Blend positions by how far we are into the next 1/60 s step (0 while paused).
    const alpha = this.paused ? 1 : this.acc / TICK_MS;
    this.renderer?.render(blendPositions(this.state, this.prevPositions, alpha), { showHitboxes: getSettings().showHitboxes });
  };

  /** Advances one simulation frame (public for tests/debug tools). */
  step(): void {
    const s = getSettings();
    const held = this.keyboard?.held ?? new Set<string>();
    const p1 = bitsFromKeys(s.p1, held);
    const p2 = this.ai ? this.ai.update(this.state) : bitsFromKeys(s.p2, held);
    const wasEnded = this.state.phase === 'matchEnd';
    const events = stepMatch(this.state, [p1, p2]);
    this.debug.steps++;
    this.debug.lastInput = [p1, p2];
    for (const e of events) if (e.type === 'hit') this.debug.lastHit = { frame: this.state.frame, attacker: e.attacker, damage: e.damage };
    this.combos.handle(events, this.state.frame);
    this.renderer?.handleEvents(events);
    audio.playEvents(events);
    this.publish();
    if (!wasEnded && this.state.phase === 'matchEnd') this.onMatchEnd?.();
  }

  private publish(): void {
    this.hud.set(deriveHud(this.state, this.names, this.combos));
  }
}
