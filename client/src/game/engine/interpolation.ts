import type { MatchState } from '../../../../shared/src/engine/state';
import type { NetState } from '../../../../shared/src/protocol';

/** Positions captured just before a simulation step. */
export interface PositionSnapshot {
  fighters: [number, number, number, number]; // x0, y0, x1, y1
  projectiles: Map<number, number>; // id -> x
}

export function capturePositions(s: MatchState | NetState): PositionSnapshot {
  const [a, b] = s.fighters;
  return { fighters: [a.x, a.y, b.x, b.y], projectiles: new Map(s.projectiles.map((p) => [p.id, p.x])) };
}

/** Moves further than this in one step are teleports (round reset): never blended. */
const TELEPORT = 120;

/**
 * Render view between the previous and current simulation step (alpha in [0,1]).
 * Only positions are blended; animation frames, health and every other discrete value
 * come from the current state, so pixel art stays crisp and combat stays exact.
 * The simulation state itself is never modified.
 */
export function blendPositions<T extends MatchState | NetState>(s: T, prev: PositionSnapshot | null, alpha: number): T {
  if (!prev || alpha >= 1) return s;
  const t = Math.max(0, alpha);
  const lerp = (a: number, b: number) => (Math.abs(b - a) > TELEPORT ? b : a + (b - a) * t);
  const fighters = s.fighters.map((f, i) => ({ ...f, x: lerp(prev.fighters[i * 2], f.x), y: lerp(prev.fighters[i * 2 + 1], f.y) }));
  const projectiles = s.projectiles.map((p) => {
    const px = prev.projectiles.get(p.id);
    return px === undefined ? p : { ...p, x: lerp(px, p.x) };
  });
  return { ...s, fighters, projectiles } as T;
}
