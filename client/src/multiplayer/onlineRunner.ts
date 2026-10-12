import { TICK_MS } from '../../../shared/src/constants';
import { getCharacter } from '../../../shared/src/characters/roster';
import type { GameEvent } from '../../../shared/src/engine/sim';
import type { NetState, ServerMessage } from '../../../shared/src/protocol';
import { audio } from '../game/audio/audio';
import { loadCharacterSprites } from '../game/animation/sprites';
import { ComboTracker, HudStore, deriveHud } from '../game/hud';
import { allCodes, bitsFromKeys } from '../game/input/bindings';
import { KeyboardState } from '../game/input/keyboard';
import { Renderer } from '../game/rendering/renderer';
import { getSettings } from '../settings';
import type { NetClient } from './netClient';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }> & { recv: number };

/** Render this many simulation frames behind the newest snapshot (smooths 30 Hz snapshots). */
export const INTERP_DELAY_FRAMES = 4;

/** Linear interpolation of positions between two server snapshots. */
export function interpolate(a: NetState, b: NetState, t: number): NetState {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const fighters = a.fighters.map((f, i) => {
    const g = b.fighters[i];
    // Do not smear teleports (round resets).
    if (Math.abs(g.x - f.x) > 120) return f;
    return { ...f, x: lerp(f.x, g.x), y: lerp(f.y, g.y) };
  }) as NetState['fighters'];
  const projectiles = a.projectiles.map((p) => {
    const q = b.projectiles.find((r) => r.id === p.id);
    return q ? { ...p, x: lerp(p.x, q.x) } : p;
  });
  return { ...a, fighters, projectiles };
}

/**
 * Online match view: sends local input to the server every frame it changes (and as a
 * heartbeat), renders interpolated authoritative snapshots. The client never decides
 * damage, health or results.
 */
export class OnlineRunner {
  readonly hud = new HudStore();
  private renderer: Renderer | null = null;
  private keyboard: KeyboardState | null = null;
  private snaps: Snapshot[] = [];
  private combos = new ComboTracker();
  private raf = 0;
  private lastSent = -1;
  private sinceSend = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private names: [string, string];
  current: NetState | null = null;

  constructor(
    private net: NetClient,
    private matchId: number,
    readonly chars: [string, string],
    private stage: string,
    names?: [string, string],
  ) {
    this.names = names ?? [getCharacter(chars[0]).name, getCharacter(chars[1]).name];
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.keyboard) this.detach();
    this.keyboard = new KeyboardState();
    this.keyboard.capture(allCodes(getSettings().p1));
    this.renderer = new Renderer(canvas, this.stage);
    void Promise.all([loadCharacterSprites(this.chars[0], 168), loadCharacterSprites(this.chars[1], 168)])
      .then((s) => this.renderer?.setSprites(s))
      .catch((e) => console.error(e));
    this.unsub = this.net.onSnapshot((m) => this.onSnapshot(m));
    // Input runs on its own 60 Hz timer so it keeps flowing even when rendering is throttled.
    this.inputTimer = setInterval(this.sampleInput, TICK_MS);
    this.raf = requestAnimationFrame(this.loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    if (this.inputTimer) clearInterval(this.inputTimer);
    this.inputTimer = null;
    this.unsub?.();
    this.unsub = null;
    this.keyboard?.dispose();
    this.keyboard = null;
    this.renderer = null;
  }

  private onSnapshot(m: Extract<ServerMessage, { t: 'snapshot' }>): void {
    if (m.matchId !== this.matchId) return;
    const last = this.snaps[this.snaps.length - 1];
    if (last && m.frame <= last.frame) return;
    this.snaps.push({ ...m, recv: performance.now() });
    if (this.snaps.length > 30) this.snaps.shift();
    this.handleEvents(m.events, m.frame);
  }

  private handleEvents(events: GameEvent[], frame: number): void {
    if (!events.length) return;
    this.combos.handle(events, frame);
    this.renderer?.handleEvents(events);
    audio.playEvents(events);
  }

  /** Input: sampled at 60 Hz, sent on change plus a heartbeat every 10 samples. */
  private sampleInput = () => {
    const bits = bitsFromKeys(getSettings().p1, this.keyboard?.held ?? new Set<string>());
    this.sinceSend++;
    if (bits !== this.lastSent || this.sinceSend >= 10) {
      this.net.sendInput(bits);
      this.lastSent = bits;
      this.sinceSend = 0;
    }
  };

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const state = this.sample(now);
    if (state) {
      this.current = state;
      this.renderer?.render(state, { showHitboxes: getSettings().showHitboxes });
      this.hud.set(deriveHud(state, this.names, this.combos));
    }
  };

  /** Picks the interpolated state INTERP_DELAY_FRAMES behind the estimated server frame. */
  private sample(now: number): NetState | null {
    const n = this.snaps.length;
    if (!n) return null;
    const newest = this.snaps[n - 1];
    const estimate = newest.frame + (now - newest.recv) / TICK_MS;
    const target = Math.min(newest.frame, estimate - INTERP_DELAY_FRAMES);
    for (let i = n - 1; i > 0; i--) {
      const a = this.snaps[i - 1];
      const b = this.snaps[i];
      if (a.frame <= target && target <= b.frame) {
        return interpolate(a.state, b.state, (target - a.frame) / Math.max(1, b.frame - a.frame));
      }
    }
    return target < this.snaps[0].frame ? this.snaps[0].state : newest.state;
  }
}
