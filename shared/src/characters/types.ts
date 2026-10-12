/**
 * Box relative to a fighter's feet: x grows in the facing direction, y is the offset
 * above the ground contact point (negative = up), matching canvas coordinates.
 */
export interface RelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** high: whiffs over crouchers; mid: block standing or crouching; low: must crouch-block; overhead: must stand-block. */
export type HitLevel = 'high' | 'mid' | 'low' | 'overhead';

export type MoveSlot =
  | 'lp'
  | 'hp'
  | 'lk'
  | 'hk'
  | 'crLk'
  | 'launcher'
  | 'airPunch'
  | 'airKick'
  | 'special'
  | 'specialAlt'
  | 'super';

export type CancelTarget = 'normal' | 'heavy' | 'special' | 'super';

export interface ProjectileDef {
  /** Frame (since move start) on which the projectile spawns. */
  spawnFrame: number;
  offsetX: number;
  offsetY: number;
  speed: number;
  w: number;
  h: number;
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  /** Frames before it disappears. */
  life: number;
  /** Number of hits (multi-hit projectiles re-hit every `hitInterval` frames). */
  hits?: number;
  hitInterval?: number;
  knockdown?: boolean;
  /** Visual style key for the renderer. */
  effect: string;
  color: string;
}

export interface MoveDef {
  id: string;
  name: string;
  /** Animation key in the character's sprite metadata. */
  anim: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  /** Horizontal push applied to the defender (px/frame, decays with friction). */
  knockback: number;
  /** Upward launch velocity; launched defenders are knocked down and can be juggled. */
  launch?: number;
  knockdown?: boolean;
  level: HitLevel;
  hitbox: RelBox;
  /** Number of hits spread evenly across the active frames (default 1). */
  hits?: number;
  /** Meter gained by the attacker on hit (half on block). */
  meterGain: number;
  meterCost?: number;
  /** Frames (counted from move start) in which a confirmed hit may be cancelled. */
  cancelWindow?: [number, number];
  cancelInto?: CancelTarget[];
  /** Forward velocity applied while the move is in startup/active frames. */
  advance?: number;
  /** Vertical velocity on start (rising moves). */
  rise?: number;
  /** Fully invulnerable for these frames from move start (reversals / supers). */
  invuln?: number;
  /** Absorbs one hit during startup without being interrupted (takes damage). */
  armor?: boolean;
  /** Counter stance: if struck during active frames, retaliates with `counterHit` instead. */
  counter?: boolean;
  projectile?: ProjectileDef;
  hitstop?: number;
  airborne?: boolean;
  /** Short flavour text for the move list. */
  description: string;
}

export interface CharacterStats {
  maxHealth: number;
  walkSpeed: number;
  backWalkSpeed: number;
  dashSpeed: number;
  backdashSpeed: number;
  jumpVelocity: number;
  jumpForward: number;
  /** Hurtbox width/height when standing (world px). */
  width: number;
  height: number;
  crouchHeight: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** Short archetype label shown on the select screen. */
  archetype: string;
  tagline: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  accent: string;
  /** Sprite draw scale (sheet pixels -> world pixels). */
  renderScale: number;
  stats: CharacterStats;
  moves: Record<MoveSlot, MoveDef>;
  /** Signature super name shown in the banner. */
  superName: string;
}
