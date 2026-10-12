import { getCharacter, moveDuration } from '../../../../shared/src/characters/roster';
import { movePhase } from '../../../../shared/src/engine/boxes';
import type { NetFighter } from '../../../../shared/src/protocol';
import type { AnimMeta, CharacterSprites } from './sprites';

export interface FrameChoice {
  anim: string;
  key: string;
}

function byTicks(anim: AnimMeta, t: number): string {
  const total = anim.ticks.reduce((a, b) => a + b, 0);
  let k = anim.loop ? t % total : Math.min(t, total - 1);
  for (let i = 0; i < anim.frames.length; i++) {
    if (k < anim.ticks[i]) return anim.frames[i];
    k -= anim.ticks[i];
  }
  return anim.frames[anim.frames.length - 1];
}

/**
 * Attack animations tag frames with move phases; the phase's frames are spread evenly
 * over the move's real startup/active/recovery frame counts, so art and hitboxes agree.
 */
function byPhase(anim: AnimMeta, f: NetFighter): string {
  const m = getCharacter(f.char).moves[f.move!];
  const frame = Math.min(f.actionFrame, moveDuration(m) - 1);
  const phase = movePhase(m, frame);
  const idx = anim.phases!.map((p, i) => [p, i] as const).filter(([p]) => p === phase).map(([, i]) => i);
  if (!idx.length) return byTicks(anim, frame);
  const [start, len] = phase === 'startup' ? [0, m.startup] : phase === 'active' ? [m.startup, m.active] : [m.startup + m.active, m.recovery];
  const t = (frame - start) / Math.max(1, len);
  return anim.frames[idx[Math.min(idx.length - 1, Math.floor(t * idx.length))]];
}

/** Chooses the animation and frame key for a fighter's current state. */
export function chooseFrame(sprites: CharacterSprites, f: NetFighter, globalFrame: number): FrameChoice {
  const A = sprites.animations;
  const pick = (name: string, t: number): FrameChoice => {
    const anim = A[name] ?? A.idle;
    return { anim: name, key: byTicks(anim, t) };
  };
  switch (f.action) {
    case 'intro':
      return pick('intro', f.actionFrame);
    case 'idle':
      return pick('idle', globalFrame);
    case 'walk':
      return pick('walk', f.actionFrame);
    case 'walkBack':
      return pick('walkBack', f.actionFrame);
    case 'crouch':
      return pick(f.blocking ? 'crouchBlock' : 'crouch', f.actionFrame);
    case 'jumpSquat':
    case 'land':
      return { anim: 'jump', key: A.jump.frames[0] };
    case 'jump':
      return { anim: 'jump', key: A.jump.frames[f.vy < 0 ? 1 : Math.min(2, A.jump.frames.length - 1)] };
    case 'dash':
      return pick('run', f.actionFrame);
    case 'backdash':
      return pick('backdash', f.actionFrame);
    case 'hitstun':
      return pick('hurt', f.actionFrame);
    case 'blockstun':
      return pick(f.crouching ? 'crouchBlock' : 'block', f.actionFrame);
    case 'knockdown': {
      if (f.grounded && f.health <= 0) return pick('dizzy', f.actionFrame);
      const kd = A.knockdown;
      const n = kd.frames.length;
      if (!f.grounded) return { anim: 'knockdown', key: kd.frames[Math.min(n - 3, f.vy < 0 ? 0 : 1)] ?? kd.frames[0] };
      return { anim: 'knockdown', key: kd.frames[Math.min(n - 1, n - 2 + (f.actionFrame > 10 ? 1 : 0))] };
    }
    case 'getup':
      return pick('getup', f.actionFrame);
    case 'victory':
      return pick('victory', f.actionFrame);
    case 'timeoutLoss':
      return pick('timeoutLoss', f.actionFrame);
    case 'attack': {
      const m = getCharacter(f.char).moves[f.move!];
      const anim = A[m.anim] ?? A.lp;
      if (anim.phases) return { anim: m.anim, key: byPhase(anim, f) };
      return { anim: m.anim, key: byTicks(anim, f.actionFrame) };
    }
    default:
      return pick('idle', globalFrame);
  }
}
