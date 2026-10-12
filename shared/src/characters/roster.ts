import type { CharacterDef, CharacterStats, MoveDef, MoveSlot, ProjectileDef } from './types';

/**
 * Fictional gameplay designs inspired by each sprite sheet's artwork. They are not
 * statements about the real people the characters are named after.
 *
 * Frame data is in 60 Hz frames. Damage is out of 1000 health.
 */

type MovePatch = Partial<MoveDef> & { projectile?: ProjectileDef };

const baseStats: CharacterStats = {
  maxHealth: 1000,
  walkSpeed: 3.2,
  backWalkSpeed: 2.6,
  dashSpeed: 10,
  backdashSpeed: 8.5,
  jumpVelocity: 17,
  jumpForward: 4.4,
  width: 54,
  height: 150,
  crouchHeight: 96,
};

function baseMoves(): Record<MoveSlot, MoveDef> {
  return {
    lp: {
      id: 'lp', name: 'Jab', anim: 'lp', startup: 4, active: 3, recovery: 8,
      damage: 32, chip: 0, hitstun: 14, blockstun: 9, knockback: 3.2, level: 'high',
      hitbox: { x: 18, y: -122, w: 66, h: 30 }, meterGain: 4,
      cancelWindow: [3, 12], cancelInto: ['normal', 'heavy', 'special', 'super'],
      description: 'Fast jab. Chains into heavies and specials.',
    },
    hp: {
      id: 'hp', name: 'Straight', anim: 'hp', startup: 7, active: 4, recovery: 16,
      damage: 72, chip: 4, hitstun: 20, blockstun: 14, knockback: 5.6, level: 'mid',
      hitbox: { x: 22, y: -126, w: 84, h: 36 }, meterGain: 8,
      cancelWindow: [6, 16], cancelInto: ['special', 'super'], hitstop: 7,
      description: 'Strong punch. Cancel into a special on hit or block.',
    },
    lk: {
      id: 'lk', name: 'Snap Kick', anim: 'lk', startup: 5, active: 3, recovery: 10,
      damage: 40, chip: 0, hitstun: 15, blockstun: 10, knockback: 3.6, level: 'mid',
      hitbox: { x: 18, y: -88, w: 78, h: 32 }, meterGain: 5,
      cancelWindow: [4, 13], cancelInto: ['heavy', 'special', 'super'],
      description: 'Quick mid kick.',
    },
    hk: {
      id: 'hk', name: 'Roundhouse', anim: 'hk', startup: 9, active: 4, recovery: 20,
      damage: 88, chip: 5, hitstun: 22, blockstun: 15, knockback: 7, level: 'mid',
      hitbox: { x: 20, y: -120, w: 98, h: 44 }, meterGain: 10,
      cancelWindow: [8, 18], cancelInto: ['special', 'super'], hitstop: 8,
      description: 'Long-reaching heavy kick.',
    },
    crLk: {
      id: 'crLk', name: 'Low Kick', anim: 'lk', startup: 5, active: 3, recovery: 11,
      damage: 34, chip: 0, hitstun: 14, blockstun: 9, knockback: 3, level: 'low',
      hitbox: { x: 16, y: -34, w: 80, h: 32 }, meterGain: 4,
      cancelWindow: [4, 13], cancelInto: ['heavy', 'special', 'super'],
      description: 'Crouching low. Must be blocked crouching.',
    },
    launcher: {
      id: 'launcher', name: 'Sweep', anim: 'launcher', startup: 9, active: 5, recovery: 24,
      damage: 76, chip: 4, hitstun: 30, blockstun: 16, knockback: 4, level: 'low', knockdown: true,
      hitbox: { x: 16, y: -40, w: 100, h: 40 }, meterGain: 10, hitstop: 8,
      description: 'Down + Heavy Kick. Low knockdown.',
    },
    airPunch: {
      id: 'airPunch', name: 'Air Punch', anim: 'airPunch', startup: 5, active: 8, recovery: 6,
      damage: 52, chip: 2, hitstun: 18, blockstun: 12, knockback: 4, level: 'overhead',
      hitbox: { x: 10, y: -110, w: 70, h: 50 }, meterGain: 6, airborne: true,
      description: 'Jumping punch. Overhead.',
    },
    airKick: {
      id: 'airKick', name: 'Air Kick', anim: 'airKick', startup: 6, active: 9, recovery: 8,
      damage: 64, chip: 3, hitstun: 20, blockstun: 13, knockback: 4.5, level: 'overhead',
      hitbox: { x: 8, y: -80, w: 82, h: 56 }, meterGain: 7, airborne: true,
      description: 'Jumping kick. Overhead, great for jump-ins.',
    },
    special: {
      id: 'special', name: 'Special', anim: 'special', startup: 12, active: 4, recovery: 22,
      damage: 90, chip: 12, hitstun: 22, blockstun: 16, knockback: 6, level: 'mid',
      hitbox: { x: 20, y: -126, w: 96, h: 50 }, meterGain: 12, meterCost: 0,
      cancelWindow: [12, 18], cancelInto: ['super'], hitstop: 9,
      description: 'Character special.',
    },
    specialAlt: {
      id: 'specialAlt', name: 'Special 2', anim: 'launcher', startup: 8, active: 6, recovery: 26,
      damage: 84, chip: 10, hitstun: 26, blockstun: 16, knockback: 4, level: 'mid',
      hitbox: { x: 10, y: -150, w: 80, h: 150 }, meterGain: 12,
      cancelWindow: [8, 16], cancelInto: ['super'], hitstop: 9,
      description: 'Character special (Down + Special).',
    },
    super: {
      id: 'super', name: 'Super', anim: 'super', startup: 10, active: 24, recovery: 30,
      damage: 300, chip: 40, hitstun: 40, blockstun: 22, knockback: 6, level: 'mid', knockdown: true,
      hitbox: { x: -10, y: -150, w: 150, h: 150 }, hits: 5, meterGain: 0, meterCost: 100,
      invuln: 12, hitstop: 6,
      description: 'Super attack. Costs a full meter.',
    },
  };
}

function fireball(patch: Partial<ProjectileDef>): ProjectileDef {
  return {
    spawnFrame: 11, offsetX: 70, offsetY: -112, speed: 7.5, w: 46, h: 36,
    damage: 80, chip: 10, hitstun: 20, blockstun: 16, knockback: 5, life: 110,
    effect: 'fireball', color: '#ff8a1f', ...patch,
  };
}

function make(
  id: string,
  name: string,
  info: Pick<CharacterDef, 'archetype' | 'tagline' | 'difficulty' | 'accent' | 'superName'>,
  stats: Partial<CharacterStats>,
  moves: Partial<Record<MoveSlot, MovePatch>>,
  renderScale = 1.08,
): CharacterDef {
  const base = baseMoves();
  const merged = {} as Record<MoveSlot, MoveDef>;
  for (const slot of Object.keys(base) as MoveSlot[]) {
    merged[slot] = { ...base[slot], ...(moves[slot] ?? {}), id: slot };
  }
  return { id, name, ...info, renderScale, stats: { ...baseStats, ...stats }, moves: merged };
}

export const ROSTER: CharacterDef[] = [
  make(
    'rick', 'Rick',
    { archetype: 'Rushdown', tagline: 'Quick hands, explosive burst.', difficulty: 'Medium', accent: '#ff7a1a', superName: 'HEMI INFERNO' },
    { walkSpeed: 3.4, dashSpeed: 11, maxHealth: 980 },
    {
      lp: { startup: 3, recovery: 7, damage: 30, name: 'Beanie Jab' },
      hp: { startup: 6, name: 'Hoodie Haymaker' },
      lk: { name: 'Bat Poke', hitbox: { x: 20, y: -100, w: 100, h: 30 }, startup: 6, damage: 44 },
      hk: { name: 'Overhead Bat', level: 'overhead', startup: 13, damage: 86, hitbox: { x: 10, y: -170, w: 110, h: 150 } },
      launcher: { name: 'Bat Slam', level: 'mid', launch: 13, knockdown: true, hitbox: { x: 20, y: -80, w: 100, h: 80 } },
      special: {
        name: 'Burst Punch', startup: 12, active: 6, recovery: 26, advance: 6.5, hits: 2, damage: 80,
        hitbox: { x: 14, y: -130, w: 110, h: 56 },
        description: 'Dashing two-hit burst punch that closes distance fast.',
      },
      specialAlt: {
        name: 'Rising Burst', anim: 'launcher', startup: 5, active: 8, rise: 12, invuln: 6, launch: 14, knockdown: true,
        damage: 90, hitbox: { x: 0, y: -175, w: 80, h: 175 },
        description: 'Invulnerable rising anti-air.',
      },
      super: { name: 'Hemi Inferno', advance: 4.5, hits: 6, damage: 320, description: 'Spinning flame-bat rush.' },
    },
  ),
  make(
    'jeremy', 'Jeremy',
    { archetype: 'Pressure Tank', tagline: 'Heavy punches, rock-solid guard.', difficulty: 'Easy', accent: '#3d6bff', superName: 'GRAND SLAM' },
    { maxHealth: 1050, walkSpeed: 2.8, backWalkSpeed: 2.2, dashSpeed: 8.5, jumpVelocity: 16, width: 60 },
    {
      lp: { damage: 36, name: 'Heavy Jab' },
      hp: { damage: 84, knockback: 6.5, name: 'Beard Breaker', hitstun: 22 },
      lk: { name: 'Bat Jab', hitbox: { x: 20, y: -96, w: 104, h: 30 }, damage: 46 },
      hk: { name: 'Bat Swing', damage: 100, startup: 11, hitbox: { x: 10, y: -160, w: 120, h: 130 } },
      launcher: { name: 'Ground Pound', level: 'mid', launch: 12, damage: 86, hitbox: { x: 20, y: -70, w: 110, h: 70 } },
      special: {
        name: 'Haymaker Wave', projectile: fireball({ speed: 6, w: 56, h: 44, damage: 80, color: '#ffb02e', effect: 'wave' }),
        damage: 0, startup: 11, recovery: 17, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Slow, heavy fire wave projectile.',
      },
      specialAlt: {
        name: 'Guard Crush', anim: 'hp', startup: 14, active: 5, armor: true, advance: 3, damage: 110, chip: 20,
        blockstun: 24, knockback: 9, level: 'mid', hitbox: { x: 20, y: -130, w: 100, h: 60 },
        description: 'Armored punch: absorbs one hit during startup.',
      },
      super: { name: 'Grand Slam', damage: 340, hits: 4, advance: 3, description: 'Flaming bat home-run swing.' },
    },
  ),
  make(
    'jcv', 'JCV',
    { archetype: 'Speedster', tagline: 'Agile strikes, flash-step combos.', difficulty: 'Hard', accent: '#e83d6f', superName: 'RIFF STORM' },
    { maxHealth: 900, walkSpeed: 3.8, backWalkSpeed: 3.3, dashSpeed: 12.5, backdashSpeed: 10, jumpVelocity: 18, jumpForward: 5.2 },
    {
      lp: { startup: 3, recovery: 6, damage: 26, cancelWindow: [2, 12] },
      lk: { name: 'Quick Bat', startup: 4, damage: 38, hitbox: { x: 20, y: -100, w: 96, h: 30 }, cancelWindow: [3, 14] },
      hk: { name: 'Hair-Whip Swing', startup: 8, damage: 82, hitbox: { x: 10, y: -160, w: 116, h: 120 } },
      crLk: { startup: 4, damage: 30 },
      special: {
        name: 'Flash Step', anim: 'run', startup: 9, active: 10, recovery: 30, advance: 10.5, hits: 1, damage: 60, invuln: 2,
        hitbox: { x: 0, y: -140, w: 70, h: 120 }, knockback: 5,
        description: 'Blinding dash-through strike.',
      },
      specialAlt: {
        name: 'Air Riff', anim: 'airKick', startup: 6, active: 10, rise: 13, launch: 11, knockdown: true,
        damage: 70, hitbox: { x: 0, y: -170, w: 90, h: 140 },
        description: 'Leaping bat strike that launches.',
      },
      super: { name: 'Riff Storm', hits: 7, advance: 5, damage: 300, description: 'Seven-hit flaming bat flurry.' },
    },
  ),
  make(
    'joshua', 'Joshua',
    { archetype: 'All-Rounder', tagline: 'Balanced and beginner-friendly.', difficulty: 'Easy', accent: '#ffa21a', superName: 'CYCLONE KICK' },
    { walkSpeed: 3.4, maxHealth: 1020 },
    {
      hp: { name: 'Hemi Straight', damage: 78 },
      hk: { name: 'High Kick', damage: 94, hitbox: { x: 20, y: -150, w: 106, h: 60 } },
      launcher: { name: 'Burst Stomp', level: 'low', knockdown: true },
      special: {
        name: 'Hemi Spark', projectile: fireball({ color: '#ff7a1a', damage: 86 }), damage: 0, startup: 11, recovery: 15, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Classic fireball.',
      },
      specialAlt: {
        name: 'Rising Kick', anim: 'launcher', startup: 5, active: 8, rise: 13, invuln: 5, launch: 14, knockdown: true,
        damage: 88, hitbox: { x: 0, y: -180, w: 80, h: 180 },
        description: 'Invulnerable rising anti-air kick.',
      },
      super: { name: 'Cyclone Kick', hits: 5, advance: 4, description: 'Spinning flame kick.' },
    },
  ),
  make(
    'max-sanchez', 'Max Sanchez',
    { archetype: 'Launcher', tagline: 'Heavy kicks that send foes flying.', difficulty: 'Medium', accent: '#c9853a', superName: 'BLAZE WHEEL' },
    { walkSpeed: 3.3, jumpVelocity: 17.5, maxHealth: 1080 },
    {
      lk: { damage: 46, hitbox: { x: 18, y: -110, w: 92, h: 40 } },
      hk: { name: 'Axe Kick', damage: 100, startup: 10, hitbox: { x: 18, y: -160, w: 110, h: 90 } },
      launcher: { name: 'Launch Kick', level: 'mid', launch: 16, knockdown: true, damage: 82, startup: 8, hitbox: { x: 16, y: -150, w: 90, h: 150 } },
      special: {
        name: 'Blaze Punch', projectile: fireball({ speed: 8.5, w: 40, h: 30, damage: 64, color: '#ff5a1a' }),
        damage: 0, startup: 11, recovery: 17, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Fast fire-punch projectile.',
      },
      specialAlt: {
        name: 'Sky Kick', anim: 'launcher', startup: 7, active: 8, rise: 15, launch: 17, knockdown: true, damage: 96,
        hitbox: { x: 0, y: -190, w: 90, h: 190 }, invuln: 3,
        description: 'Huge launcher kick; juggle afterwards.',
      },
      super: { name: 'Blaze Wheel', hits: 5, damage: 330, advance: 4, description: 'Flame-ring roundhouse.' },
    },
  ),
  make(
    'koala', 'Koala',
    { archetype: 'Chainsaw Bruiser', tagline: 'The Fired Intern. Revs, grinds, rampages.', difficulty: 'Medium', accent: '#ff6a00', superName: 'FINAL PAYCHECK' },
    { maxHealth: 1000, walkSpeed: 2.8, dashSpeed: 9.5, jumpVelocity: 16.5 },
    {
      lp: { name: 'Saw Bump', hitbox: { x: 20, y: -100, w: 90, h: 36 } },
      hp: { name: 'Saw Thrust', hitbox: { x: 20, y: -100, w: 94, h: 40 }, damage: 70 },
      lk: { name: 'Rev Poke', hitbox: { x: 20, y: -100, w: 98, h: 34 }, damage: 40 },
      hk: { name: 'Splatter Swing', hits: 2, damage: 90, startup: 10, hitbox: { x: 10, y: -150, w: 124, h: 120 } },
      launcher: { name: 'Leaping Saw', level: 'overhead', rise: 9, launch: 12, knockdown: true, startup: 12, damage: 90, hitbox: { x: 10, y: -150, w: 120, h: 130 } },
      special: {
        name: 'Rev Grind', startup: 12, active: 20, recovery: 28, hits: 5, damage: 85, advance: 1.2, chip: 10,
        hitstun: 16, blockstun: 10, knockback: 1.2, hitbox: { x: 20, y: -110, w: 120, h: 50 },
        description: 'Five-hit chainsaw grind. Heavy chip damage.',
      },
      specialAlt: {
        name: 'Spark Spray', anim: 'lk', projectile: fireball({ speed: 6.5, w: 70, h: 30, damage: 30, hits: 3, hitInterval: 8, life: 60, color: '#ff3b2e', effect: 'sparks', offsetY: -96 }),
        damage: 0, startup: 11, recovery: 17, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Short-range multi-hit spark spray.',
      },
      super: { name: 'Final Paycheck', hits: 8, damage: 310, advance: 5, description: 'Flaming chainsaw rampage.' },
    },
  ),
  make(
    'migo', 'Migo',
    { archetype: 'Counter Fencer', tagline: 'Balanced sword play and counters.', difficulty: 'Medium', accent: '#ff8c1a', superName: 'RAM TEMPEST' },
    { maxHealth: 980, width: 56, height: 140, crouchHeight: 90 },
    {
      lp: { name: 'Hilt Strike', hitbox: { x: 18, y: -110, w: 78, h: 36 } },
      hp: { name: 'Crescent Slash', hitbox: { x: 16, y: -150, w: 112, h: 100 }, damage: 78 },
      lk: { name: 'Low Thrust', level: 'low', hitbox: { x: 18, y: -50, w: 98, h: 34 } },
      hk: { name: 'Rising Slash', hitbox: { x: 16, y: -160, w: 110, h: 130 } },
      special: {
        name: 'Crescent Wave', projectile: fireball({ speed: 7.5, w: 40, h: 70, offsetY: -110, color: '#ffd23a', effect: 'crescent' }),
        damage: 0, startup: 11, recovery: 17, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Sword wave projectile.',
      },
      specialAlt: {
        name: 'Counter Stance', anim: 'block', startup: 3, active: 22, recovery: 16, counter: true, damage: 120,
        hitstun: 30, knockback: 8, knockdown: true, hitbox: { x: 10, y: -150, w: 120, h: 150 },
        description: 'Parry stance: if struck, Migo counters with a heavy slash.',
      },
      super: { name: 'Ram Tempest', hits: 6, damage: 310, advance: 4, description: 'Whirling sword tempest.' },
    },
  ),
  make(
    'jeff-garzik', 'Jeff Garzik',
    { archetype: 'Precision Technician', tagline: 'Tight links, long combos.', difficulty: 'Hard', accent: '#ffb347', superName: 'HASH CYCLONE' },
    { maxHealth: 1000, walkSpeed: 3.4 },
    {
      lp: { startup: 3, damage: 34, cancelWindow: [2, 14] },
      hp: { name: 'Calculated Cross', damage: 82, startup: 6, cancelWindow: [5, 19], cancelInto: ['normal', 'special', 'super'] },
      lk: { cancelWindow: [3, 15] },
      hk: { name: 'Precision Kick', damage: 96, hitbox: { x: 20, y: -150, w: 108, h: 64 }, cancelWindow: [8, 20] },
      launcher: { name: 'Pinpoint Sweep', level: 'low', knockdown: true },
      special: {
        name: 'Precision Shot', projectile: fireball({ speed: 10, w: 30, h: 24, damage: 66, color: '#ffdd55', spawnFrame: 10 }),
        startup: 10, recovery: 15, damage: 0, hitbox: { x: 0, y: 0, w: 0, h: 0 },
        description: 'Fast, small fireball with short recovery.',
      },
      specialAlt: {
        name: 'Pinpoint Dive', anim: 'airKick', startup: 7, active: 10, rise: 10, advance: 6, damage: 86, level: 'overhead',
        knockdown: true, hitbox: { x: 10, y: -110, w: 90, h: 80 },
        description: 'Leaping overhead dive kick.',
      },
      super: { name: 'Hash Cyclone', hits: 6, damage: 310, advance: 4.5, description: 'Spinning kick cyclone.' },
    },
  ),
];

export const CHARACTER_IDS = ROSTER.map((c) => c.id);

const byId = new Map(ROSTER.map((c) => [c.id, c]));
export function getCharacter(id: string): CharacterDef {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown character: ${id}`);
  return c;
}
export function isCharacterId(id: unknown): id is string {
  return typeof id === 'string' && byId.has(id);
}

export function moveDuration(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
