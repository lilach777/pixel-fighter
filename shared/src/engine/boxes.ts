import { getCharacter } from '../characters/roster';
import type { MoveDef, RelBox } from '../characters/types';
import type { FighterState, FighterView, Projectile } from './state';

/** Axis-aligned box in world coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Converts a facing-relative box to world space. */
export function toWorld(f: Pick<FighterState, 'x' | 'y' | 'facing'>, r: RelBox): Box {
  const x = f.facing === 1 ? f.x + r.x : f.x - r.x - r.w;
  return { x, y: f.y + r.y, w: r.w, h: r.h };
}

export function currentMove(f: FighterView): MoveDef | null {
  if (f.action !== 'attack' || !f.move) return null;
  return getCharacter(f.char).moves[f.move];
}

export type MovePhase = 'startup' | 'active' | 'recovery';

export function movePhase(m: MoveDef, frame: number): MovePhase {
  if (frame < m.startup) return 'startup';
  if (frame < m.startup + m.active) return 'active';
  return 'recovery';
}

export function isCrouchingPosture(f: FighterView): boolean {
  if (f.airborne) return false;
  if (f.action === 'crouch') return true;
  if (f.action === 'blockstun' || f.action === 'hitstun') return f.crouching;
  if (f.action === 'attack') return f.move === 'crLk' || f.move === 'launcher';
  return false;
}

/**
 * Hurtboxes: the body box (shorter when crouching or airborne) plus, while an attack
 * is active or recovering, a "limb" box over part of the hitbox so whiffed attacks
 * can be punished. Lying down, getting up and invulnerable fighters have none.
 */
export function hurtboxes(f: FighterView): Box[] {
  if (f.invuln > 0) return [];
  if (f.action === 'knockdown' && f.grounded) return [];
  if (f.action === 'getup' || f.action === 'intro') return [];
  // Juggle protection: after many hits in the air the fighter becomes intangible.
  if (f.action === 'knockdown' && f.comboHits >= 12) return [];
  const s = getCharacter(f.char).stats;
  const boxes: Box[] = [];
  if (f.airborne) {
    boxes.push({ x: f.x - s.width / 2, y: f.y - s.height + 12, w: s.width, h: s.height - 30 });
  } else if (f.action === 'knockdown') {
    boxes.push({ x: f.x - s.width * 0.8, y: f.y - 60, w: s.width * 1.6, h: 60 });
  } else {
    const h = isCrouchingPosture(f) ? s.crouchHeight : s.height;
    boxes.push({ x: f.x - s.width / 2, y: f.y - h, w: s.width, h });
  }
  const m = currentMove(f);
  if (m && m.hitbox.w > 0 && movePhase(m, f.actionFrame) !== 'startup') {
    const limb: RelBox = { x: m.hitbox.x, y: m.hitbox.y + 4, w: m.hitbox.w * 0.7, h: Math.max(10, m.hitbox.h - 8) };
    boxes.push(toWorld(f, limb));
  }
  return boxes;
}

/** Active hitbox of the fighter's current attack this frame, if any hit is still due. */
export function activeHitbox(f: FighterView): { box: Box; move: MoveDef } | null {
  const m = currentMove(f);
  if (!m || m.hitbox.w <= 0) return null;
  if (movePhase(m, f.actionFrame) !== 'active') return null;
  const hits = m.hits ?? 1;
  if (f.hitsDone >= hits) return null;
  // Multi-hit: hit k becomes available at an even fraction of the active window.
  const due = m.startup + Math.floor((f.hitsDone * m.active) / hits);
  if (f.actionFrame < due || f.lastHitFrame === f.actionFrame) return null;
  return { box: toWorld(f, m.hitbox), move: m };
}

export function projectileBox(p: Projectile): Box {
  return { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
}

/** Pushbox used for body separation. */
export function pushbox(f: FighterView, halfWidth: number): Box {
  const s = getCharacter(f.char).stats;
  const h = f.airborne ? s.height - 40 : s.height;
  return { x: f.x - halfWidth, y: f.y - h, w: halfWidth * 2, h };
}
