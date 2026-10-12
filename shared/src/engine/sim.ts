import {
  COMBO_SCALING,
  DASH_TAP_WINDOW,
  GRAVITY,
  GROUND_Y,
  INTRO_FRAMES,
  MAX_ROUNDS,
  MAX_SEPARATION,
  METER_MAX,
  MIN_COMBO_SCALE,
  PUSHBOX_HALF_WIDTH,
  ROUND_END_FRAMES,
  STAGE_LEFT,
  STAGE_RIGHT,
  TICK_RATE,
} from '../constants';
import { getCharacter, moveDuration } from '../characters/roster';
import type { CancelTarget, HitLevel, MoveDef, MoveSlot } from '../characters/types';
import { Btn, has, sanitizeInput } from '../input';
import { activeHitbox, currentMove, hurtboxes, movePhase, overlaps, projectileBox, pushbox, type Box } from './boxes';
import { createFighter, type FighterState, type MatchState, type Projectile, type Slot } from './state';

export type GameEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'fight' }
  | { type: 'hit'; attacker: Slot; x: number; y: number; damage: number; combo: number; heavy: boolean; projectile: boolean }
  | { type: 'block'; attacker: Slot; x: number; y: number; chip: number }
  | { type: 'armor'; defender: Slot; x: number; y: number }
  | { type: 'counter'; defender: Slot; x: number; y: number }
  | { type: 'clash'; x: number; y: number }
  | { type: 'special'; slot: Slot; move: MoveSlot; name: string }
  | { type: 'super'; slot: Slot; name: string }
  | { type: 'projectile'; owner: Slot; id: number }
  | { type: 'jump'; slot: Slot }
  | { type: 'dash'; slot: Slot }
  | { type: 'knockdown'; slot: Slot; x: number }
  | { type: 'ko'; loser: Slot | 'both' }
  | { type: 'timeUp' }
  | { type: 'roundEnd'; winner: Slot | 'draw'; reason: string; perfect: boolean }
  | { type: 'matchEnd'; winner: Slot | 'draw' };

const ACTIONABLE = new Set(['idle', 'walk', 'walkBack', 'crouch']);
const KNOCKDOWN_LIE_FRAMES = 36;
const GETUP_FRAMES = 18;
const JUMP_SQUAT_FRAMES = 3;
const LAND_FRAMES = 3;
const AIR_ATTACK_LAND_FRAMES = 5;
const DASH_FRAMES = 16;
const DASH_CANCEL_FRAME = 3;
const BACKDASH_FRAMES = 15;
const BACKDASH_INVULN = 6;
const SUPER_FREEZE_FRAMES = 36;

function slotClass(slot: MoveSlot): CancelTarget {
  switch (slot) {
    case 'lp':
    case 'lk':
    case 'crLk':
      return 'normal';
    case 'hp':
    case 'hk':
    case 'launcher':
      return 'heavy';
    case 'special':
    case 'specialAlt':
      return 'special';
    default:
      return 'super';
  }
}

function forwardBit(f: FighterState): number {
  return f.facing === 1 ? Btn.RIGHT : Btn.LEFT;
}
function backBit(f: FighterState): number {
  return f.facing === 1 ? Btn.LEFT : Btn.RIGHT;
}

function setAction(f: FighterState, action: FighterState['action']): void {
  f.action = action;
  f.actionFrame = 0;
  if (action !== 'attack') f.move = null;
}

/** Picks an attack from the input buffer (newest presses first, priority SU > SP > HK > HP > LK > LP). */
function requestedAttack(f: FighterState, held: number): { slot: MoveSlot; button: number } | null {
  const pressed = f.buffer.reduce((a, b) => a | b, 0);
  if (!pressed) return null;
  const down = has(held, Btn.DOWN);
  const def = getCharacter(f.char);
  if (f.airborne) {
    if (has(pressed, Btn.HK) || has(pressed, Btn.LK)) return { slot: 'airKick', button: pressed & (Btn.HK | Btn.LK) };
    if (has(pressed, Btn.HP) || has(pressed, Btn.LP)) return { slot: 'airPunch', button: pressed & (Btn.HP | Btn.LP) };
    return null;
  }
  if (has(pressed, Btn.SU) && f.meter >= (def.moves.super.meterCost ?? METER_MAX)) return { slot: 'super', button: Btn.SU };
  if (has(pressed, Btn.SP)) return { slot: down ? 'specialAlt' : 'special', button: Btn.SP };
  if (has(pressed, Btn.HK)) return { slot: down ? 'launcher' : 'hk', button: Btn.HK };
  if (has(pressed, Btn.HP)) return { slot: 'hp', button: Btn.HP };
  if (has(pressed, Btn.LK)) return { slot: down ? 'crLk' : 'lk', button: Btn.LK };
  if (has(pressed, Btn.LP)) return { slot: 'lp', button: Btn.LP };
  return null;
}

function consume(f: FighterState, button: number): void {
  for (let i = 0; i < f.buffer.length; i++) f.buffer[i] &= ~button;
}

function startMove(state: MatchState, slotIdx: Slot, slot: MoveSlot, events: GameEvent[]): void {
  const f = state.fighters[slotIdx];
  const def = getCharacter(f.char);
  const m = def.moves[slot];
  const keepAirMomentum = f.airborne;
  setAction(f, 'attack');
  f.move = slot;
  f.attackId++;
  f.hitsDone = 0;
  f.lastHitFrame = -1;
  f.connected = false;
  f.armorUsed = false;
  f.blocking = false;
  f.crouching = slot === 'crLk' || slot === 'launcher';
  if (m.meterCost) f.meter = Math.max(0, f.meter - m.meterCost);
  if (!keepAirMomentum) f.vx = 0;
  if (m.airborne) f.airAttackUsed = true;
  if (m.rise) {
    f.vy = -m.rise;
    f.airborne = true;
    f.airAttackUsed = true;
  }
  if (m.invuln) f.invuln = Math.max(f.invuln, m.invuln);
  if (slot === 'super') {
    state.superFreeze = SUPER_FREEZE_FRAMES;
    state.superOwner = slotIdx;
    events.push({ type: 'super', slot: slotIdx, name: def.superName });
  } else if (slot === 'special' || slot === 'specialAlt') {
    events.push({ type: 'special', slot: slotIdx, move: slot, name: m.name });
  }
}

/** Input handling for one fighter. Returns nothing; may start actions. */
function handleInput(state: MatchState, idx: Slot, rawInput: number, events: GameEvent[]): void {
  const f = state.fighters[idx];
  const input = sanitizeInput(rawInput);
  const edges = input & ~f.lastInput;
  f.lastInput = input;
  f.buffer.pop();
  f.buffer.unshift(edges);
  f.tapAge++;

  // Dash detection (double-tap left/right).
  let dash: 'dash' | 'backdash' | null = null;
  const dirEdge = edges & (Btn.LEFT | Btn.RIGHT);
  if (dirEdge && !has(input, Btn.UP) && !has(input, Btn.DOWN)) {
    if (dirEdge === f.tapDir && f.tapAge <= DASH_TAP_WINDOW) {
      dash = dirEdge === forwardBit(f) ? 'dash' : 'backdash';
      f.tapDir = 0;
    } else {
      f.tapDir = dirEdge;
      f.tapAge = 0;
    }
  }

  f.blocking = has(input, backBit(f));

  const actionable = ACTIONABLE.has(f.action) && !f.airborne;
  const req = requestedAttack(f, input);

  // Cancels: a connected attack may be cancelled into allowed classes inside its window.
  if (f.action === 'attack' && req && f.connected) {
    const m = currentMove(f)!;
    const win = m.cancelWindow;
    const cls = slotClass(req.slot);
    if (win && f.actionFrame >= win[0] && f.actionFrame <= win[1] && m.cancelInto?.includes(cls) && req.slot !== f.move) {
      consume(f, req.button);
      startMove(state, idx, req.slot, events);
      return;
    }
  }

  // Dash attacks: a forward dash can be cancelled into any attack after a few frames, so
  // presses made while dashing are honoured instead of expiring in the input buffer.
  if (f.action === 'dash' && f.actionFrame >= DASH_CANCEL_FRAME && req) {
    consume(f, req.button);
    startMove(state, idx, req.slot, events);
    return;
  }

  if (f.action === 'jump' && req && !f.airAttackUsed) {
    consume(f, req.button);
    startMove(state, idx, req.slot, events);
    return;
  }

  if (!actionable) return;

  if (req) {
    consume(f, req.button);
    startMove(state, idx, req.slot, events);
    return;
  }

  if (dash) {
    setAction(f, dash);
    if (dash === 'backdash') f.invuln = Math.max(f.invuln, BACKDASH_INVULN);
    events.push({ type: 'dash', slot: idx });
    return;
  }

  f.crouching = false;
  if (has(input, Btn.UP)) {
    setAction(f, 'jumpSquat');
    f.jumpDir = has(input, Btn.RIGHT) ? 1 : has(input, Btn.LEFT) ? -1 : 0;
    f.vx = 0;
    return;
  }
  if (has(input, Btn.DOWN)) {
    if (f.action !== 'crouch') setAction(f, 'crouch');
    f.crouching = true;
    f.vx = 0;
    return;
  }
  const s = getCharacter(f.char).stats;
  if (has(input, forwardBit(f))) {
    if (f.action !== 'walk') setAction(f, 'walk');
    f.vx = s.walkSpeed * f.facing;
  } else if (has(input, backBit(f))) {
    if (f.action !== 'walkBack') setAction(f, 'walkBack');
    f.vx = -s.backWalkSpeed * f.facing;
  } else {
    if (f.action !== 'idle') setAction(f, 'idle');
    f.vx = 0;
  }
}

function land(f: FighterState): void {
  f.y = GROUND_Y;
  f.vy = 0;
  f.airborne = false;
  f.airAttackUsed = false;
}

/** Physics and action timers for one fighter. */
function updateFighter(state: MatchState, idx: Slot, events: GameEvent[]): void {
  const f = state.fighters[idx];
  const s = getCharacter(f.char).stats;
  if (f.invuln > 0) f.invuln--;
  if (f.flash > 0) f.flash--;

  switch (f.action) {
    case 'jumpSquat':
      if (f.actionFrame >= JUMP_SQUAT_FRAMES - 1) {
        setAction(f, 'jump');
        f.vy = -s.jumpVelocity;
        f.vx = f.jumpDir * s.jumpForward;
        f.airborne = true;
        events.push({ type: 'jump', slot: idx });
        return advance(f);
      }
      break;
    case 'dash':
      f.vx = f.facing * s.dashSpeed * Math.max(0, 1 - f.actionFrame / DASH_FRAMES);
      if (f.actionFrame >= DASH_FRAMES) {
        setAction(f, 'idle');
        f.vx = 0;
      }
      break;
    case 'backdash':
      f.vx = -f.facing * s.backdashSpeed * Math.max(0, 1 - f.actionFrame / BACKDASH_FRAMES);
      if (f.actionFrame >= BACKDASH_FRAMES) {
        setAction(f, 'idle');
        f.vx = 0;
      }
      break;
    case 'attack': {
      const m = currentMove(f)!;
      if (m.advance && f.actionFrame < m.startup + m.active) f.vx = f.facing * m.advance;
      else if (!f.airborne) f.vx *= 0.7;
      if (m.projectile && f.actionFrame === m.projectile.spawnFrame) spawnProjectile(state, idx, m, events);
      if (f.actionFrame >= moveDuration(m) - 1) {
        if (f.airborne) setAction(f, 'jump');
        else setAction(f, 'idle');
        f.crouching = false;
      }
      break;
    }
    case 'hitstun':
    case 'blockstun':
      f.stun--;
      if (!f.airborne) f.vx *= 0.86;
      if (f.stun <= 0) {
        setAction(f, f.crouching ? 'crouch' : 'idle');
        f.vx = 0;
      }
      break;
    case 'knockdown':
      if (f.grounded) {
        f.vx *= 0.8;
        if (f.health > 0 && f.actionFrame >= KNOCKDOWN_LIE_FRAMES) {
          setAction(f, 'getup');
          f.grounded = false;
        }
      }
      break;
    case 'getup':
      f.vx = 0;
      if (f.actionFrame >= GETUP_FRAMES) {
        setAction(f, 'idle');
        f.invuln = Math.max(f.invuln, 2);
      }
      break;
    case 'land':
      f.vx = 0;
      if (f.actionFrame >= f.stun) setAction(f, 'idle');
      break;
    default:
      break;
  }

  // Integrate.
  if (f.airborne) f.vy += GRAVITY;
  f.x += f.vx;
  f.y += f.vy;
  if (f.airborne && f.y >= GROUND_Y && f.vy > 0) {
    const wasAttack = f.action === 'attack';
    land(f);
    if (f.action === 'knockdown') {
      f.grounded = true;
      f.actionFrame = 0;
      f.vx *= 0.3;
      events.push({ type: 'knockdown', slot: idx, x: f.x });
    } else if (f.action === 'hitstun') {
      // Air hitstun lands into a short recovery.
    } else {
      const m = wasAttack ? currentMove(f) : null;
      // Rising specials keep their recovery on landing; air normals end.
      if (m && !m.airborne && f.actionFrame < moveDuration(m)) {
        f.vx = 0;
      } else {
        setAction(f, 'land');
        f.stun = wasAttack ? AIR_ATTACK_LAND_FRAMES : LAND_FRAMES;
        f.vx = 0;
      }
    }
  }
  if (!f.airborne) f.y = GROUND_Y;
  advance(f);
}

function advance(f: FighterState): void {
  f.actionFrame++;
}

function spawnProjectile(state: MatchState, owner: Slot, m: MoveDef, events: GameEvent[]): void {
  const f = state.fighters[owner];
  const p = m.projectile!;
  // One projectile per fighter on screen.
  if (state.projectiles.some((q) => q.owner === owner)) return;
  const proj: Projectile = {
    id: state.nextProjectileId++,
    owner,
    char: f.char,
    slot: f.move!,
    x: f.x + p.offsetX * f.facing,
    y: f.y + p.offsetY,
    vx: p.speed * f.facing,
    w: p.w,
    h: p.h,
    life: p.life,
    age: 0,
    hitsDone: 0,
    lastHitAge: -999,
    effect: p.effect,
    color: p.color,
  };
  state.projectiles.push(proj);
  events.push({ type: 'projectile', owner, id: proj.id });
}

function canBlock(def: FighterState, level: HitLevel, fromX: number): boolean {
  if (def.airborne) return false;
  if (!(ACTIONABLE.has(def.action) || def.action === 'blockstun')) return false;
  const towardAttackerIsRight = fromX > def.x;
  const holdingBack = has(def.lastInput, towardAttackerIsRight ? Btn.LEFT : Btn.RIGHT);
  if (!holdingBack) return false;
  const crouch = has(def.lastInput, Btn.DOWN);
  if (level === 'low' && !crouch) return false;
  if (level === 'overhead' && crouch) return false;
  return true;
}

interface PendingHit {
  attacker: Slot;
  defender: Slot;
  move: MoveDef;
  box: Box;
  projectile: Projectile | null;
  /** Damage-relevant values for this single hit. */
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  launch?: number;
  knockdown?: boolean;
  level: HitLevel;
  meterGain: number;
  hitstop: number;
}

function hitFromMove(attacker: Slot, defender: Slot, move: MoveDef, box: Box): PendingHit {
  const hits = move.hits ?? 1;
  return {
    attacker,
    defender,
    move,
    box,
    projectile: null,
    damage: move.damage / hits,
    chip: move.chip / hits,
    hitstun: move.hitstun,
    blockstun: move.blockstun,
    knockback: move.knockback,
    launch: move.launch,
    knockdown: move.knockdown,
    level: move.level,
    meterGain: move.meterGain / hits,
    hitstop: move.hitstop ?? (move.damage >= 70 ? 7 : 5),
  };
}

function overlapCenter(a: Box, b: Box): { x: number; y: number } {
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Collects hits for this frame from the pre-resolution state, so trades are symmetric. */
function collectHits(state: MatchState): PendingHit[] {
  const out: PendingHit[] = [];
  for (const a of [0, 1] as Slot[]) {
    const d = (1 - a) as Slot;
    const att = state.fighters[a];
    const def = state.fighters[d];
    const hb = activeHitbox(att);
    if (hb) {
      const hurts = hurtboxes(def);
      if (hurts.some((h) => overlaps(hb.box, h))) out.push(hitFromMove(a, d, hb.move, hb.box));
    }
  }
  for (const p of state.projectiles) {
    const d = (1 - p.owner) as Slot;
    const def = state.fighters[d];
    const pdef = getCharacter(p.char).moves[p.slot].projectile!;
    const hits = pdef.hits ?? 1;
    if (p.hitsDone >= hits || p.age - p.lastHitAge < (pdef.hitInterval ?? 1)) continue;
    const pb = projectileBox(p);
    if (!hurtboxes(def).some((h) => overlaps(pb, h))) continue;
    const move = getCharacter(p.char).moves[p.slot];
    out.push({
      attacker: p.owner,
      defender: d,
      move,
      box: pb,
      projectile: p,
      damage: pdef.damage / hits,
      chip: pdef.chip / hits,
      hitstun: pdef.hitstun,
      blockstun: pdef.blockstun,
      knockback: pdef.knockback,
      knockdown: pdef.knockdown && p.hitsDone === hits - 1,
      level: 'mid',
      meterGain: move.meterGain / hits,
      hitstop: 6,
    });
  }
  return out;
}

function addMeter(f: FighterState, amount: number): void {
  f.meter = Math.min(METER_MAX, f.meter + amount);
}

function applyHit(state: MatchState, h: PendingHit, events: GameEvent[]): void {
  const att = state.fighters[h.attacker];
  const def = state.fighters[h.defender];
  const fromX = h.projectile ? h.projectile.x : att.x;
  const dir = fromX <= def.x ? 1 : -1; // push direction for the defender
  const at = overlapCenter(h.box, hurtboxes(def)[0] ?? h.box);

  // Bookkeeping on the source so the same hit never applies twice.
  if (h.projectile) {
    h.projectile.hitsDone++;
    h.projectile.lastHitAge = h.projectile.age;
    const pdef = getCharacter(h.projectile.char).moves[h.projectile.slot].projectile!;
    if (h.projectile.hitsDone >= (pdef.hits ?? 1)) h.projectile.life = 0;
  } else {
    att.hitsDone++;
    att.lastHitFrame = att.actionFrame;
    att.connected = true;
  }

  // Counter stance.
  const dm = currentMove(def);
  if (dm?.counter && movePhase(dm, def.actionFrame) === 'active') {
    events.push({ type: 'counter', defender: h.defender, x: def.x, y: def.y - 100 });
    def.invuln = 20;
    def.actionFrame = dm.startup + dm.active; // jump to recovery
    if (!h.projectile && Math.abs(att.x - def.x) < 190) {
      const counterHit: PendingHit = {
        ...hitFromMove(h.defender, h.attacker, dm, h.box),
        damage: dm.damage,
        knockdown: true,
        launch: 10,
      };
      // Apply directly to the original attacker (not counterable itself).
      applyDamage(state, counterHit, events, att.x, att.y - 90);
    }
    state.hitstop = Math.max(state.hitstop, 12);
    return;
  }

  // Super armor during startup absorbs one hit.
  if (dm?.armor && !def.armorUsed && movePhase(dm, def.actionFrame) === 'startup') {
    def.armorUsed = true;
    def.health = Math.max(0, def.health - Math.round(h.damage * 0.8));
    def.flash = 6;
    events.push({ type: 'armor', defender: h.defender, x: at.x, y: at.y });
    state.hitstop = Math.max(state.hitstop, 6);
    return;
  }

  if (canBlock(def, h.level, fromX)) {
    const chip = Math.round(h.chip);
    def.health = Math.max(0, def.health - chip);
    setAction(def, 'blockstun');
    def.crouching = has(def.lastInput, Btn.DOWN);
    def.stun = h.blockstun;
    def.vx = dir * h.knockback * 0.8;
    addMeter(att, h.meterGain * 0.5);
    addMeter(def, 3);
    cornerPushback(att, def, dir, h.knockback * 0.6, !!h.projectile);
    state.hitstop = Math.max(state.hitstop, Math.max(3, h.hitstop - 3));
    events.push({ type: 'block', attacker: h.attacker, x: at.x, y: at.y, chip });
    return;
  }

  applyDamage(state, h, events, at.x, at.y);
}

function applyDamage(state: MatchState, h: PendingHit, events: GameEvent[], ex: number, ey: number): void {
  const att = state.fighters[h.attacker];
  const def = state.fighters[h.defender];
  const fromX = h.projectile ? h.projectile.x : att.x;
  const dir = fromX <= def.x ? 1 : -1;
  const scale = COMBO_SCALING[def.comboHits] ?? MIN_COMBO_SCALE;
  const dmg = Math.max(1, Math.round(h.damage * scale));
  def.health = Math.max(0, def.health - dmg);
  def.comboHits++;
  def.comboDamage += dmg;
  def.flash = 8;
  def.blocking = false;
  if (def.comboHits > state.bestCombo[h.attacker]) state.bestCombo[h.attacker] = def.comboHits;
  addMeter(att, h.meterGain);
  addMeter(def, h.meterGain * 0.5);

  const launched = h.launch !== undefined || h.knockdown || def.airborne || def.health <= 0;
  if (launched) {
    setAction(def, 'knockdown');
    def.grounded = false;
    def.airborne = true;
    const juggleDecay = Math.max(0, def.comboHits - 2) * 1.2;
    def.vy = -Math.max(5, (h.launch ?? (def.health <= 0 ? 9 : 7)) - juggleDecay);
    def.vx = dir * Math.max(2.5, h.knockback * 0.6);
    def.y = Math.min(def.y, GROUND_Y - 1);
    def.crouching = false;
  } else {
    setAction(def, 'hitstun');
    def.stun = h.hitstun;
    def.vx = dir * h.knockback;
  }
  cornerPushback(att, def, dir, h.knockback * 0.5, !!h.projectile);
  state.hitstop = Math.max(state.hitstop, h.hitstop);
  events.push({
    type: 'hit',
    attacker: h.attacker,
    x: ex,
    y: ey,
    damage: dmg,
    combo: def.comboHits,
    heavy: h.move.id === 'super' || h.damage >= 70,
    projectile: !!h.projectile,
  });
}

/** When the defender is against a wall the attacker is pushed back instead. */
function cornerPushback(att: FighterState, def: FighterState, dir: number, amount: number, projectile: boolean): void {
  if (projectile || att.airborne) return;
  const atWall = (dir > 0 && def.x >= STAGE_RIGHT - 4) || (dir < 0 && def.x <= STAGE_LEFT + 4);
  if (atWall) att.vx = -dir * amount;
}

function separate(state: MatchState): void {
  const [a, b] = state.fighters;
  const passThrough = (f: FighterState) => {
    const m = currentMove(f);
    return f.action === 'knockdown' && f.grounded ? true : !!(m && f.move === 'special' && m.anim === 'run');
  };
  if (!passThrough(a) && !passThrough(b)) {
    const pa = pushbox(a, PUSHBOX_HALF_WIDTH);
    const pb = pushbox(b, PUSHBOX_HALF_WIDTH);
    if (overlaps(pa, pb)) {
      const overlap = Math.min(pa.x + pa.w - pb.x, pb.x + pb.w - pa.x);
      const sign = a.x < b.x || (a.x === b.x && a.facing === 1) ? -1 : 1;
      a.x += (sign * overlap) / 2;
      b.x -= (sign * overlap) / 2;
    }
  }
  for (const f of state.fighters) f.x = Math.min(STAGE_RIGHT, Math.max(STAGE_LEFT, f.x));
  // If clamping re-created an overlap at a wall, push the other fighter out.
  if (!passThrough(a) && !passThrough(b)) {
    const minGap = PUSHBOX_HALF_WIDTH * 2;
    const vertical = Math.abs(a.y - b.y) < 100;
    if (vertical && Math.abs(a.x - b.x) < minGap) {
      const [left, right] = a.x <= b.x ? [a, b] : [b, a];
      if (left.x <= STAGE_LEFT) right.x = left.x + minGap;
      else if (right.x >= STAGE_RIGHT) left.x = right.x - minGap;
    }
  }
  // Camera bound: fighters can't get further apart than MAX_SEPARATION.
  if (b.x - a.x > MAX_SEPARATION) {
    const excess = b.x - a.x - MAX_SEPARATION;
    if (Math.abs(a.vx) >= Math.abs(b.vx)) a.x += excess;
    else b.x -= excess;
  } else if (a.x - b.x > MAX_SEPARATION) {
    const excess = a.x - b.x - MAX_SEPARATION;
    if (Math.abs(a.vx) >= Math.abs(b.vx)) a.x -= excess;
    else b.x += excess;
  }
}

function updateFacing(state: MatchState): void {
  const [a, b] = state.fighters;
  for (const [f, o] of [
    [a, b],
    [b, a],
  ] as const) {
    if (f.airborne) continue;
    if (!(ACTIONABLE.has(f.action) || f.action === 'land' || f.action === 'intro')) continue;
    if (o.x !== f.x) {
      const want: 1 | -1 = o.x > f.x ? 1 : -1;
      if (want !== f.facing) {
        f.facing = want;
        // A walking fighter that turned around keeps walking in the same screen direction.
        if (f.action === 'walk') f.action = 'walkBack';
        else if (f.action === 'walkBack') f.action = 'walk';
      }
    }
  }
}

function updateProjectiles(state: MatchState, events: GameEvent[]): void {
  for (const p of state.projectiles) {
    p.x += p.vx;
    p.age++;
    p.life--;
  }
  // Opposing projectiles cancel each other out.
  const [p0, p1] = [state.projectiles.find((p) => p.owner === 0), state.projectiles.find((p) => p.owner === 1)];
  if (p0 && p1 && p0.life > 0 && p1.life > 0 && overlaps(projectileBox(p0), projectileBox(p1))) {
    p0.life = 0;
    p1.life = 0;
    events.push({ type: 'clash', x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
  }
}

function resetForRound(state: MatchState): void {
  const meters = state.fighters.map((f) => f.meter);
  state.fighters = [createFighter(state.fighters[0].char, 0), createFighter(state.fighters[1].char, 1)];
  state.fighters[0].meter = meters[0];
  state.fighters[1].meter = meters[1];
  state.projectiles = [];
  state.timer = state.config.roundSeconds * TICK_RATE;
  state.hitstop = 0;
  state.superFreeze = 0;
  state.superOwner = -1;
}

function endRound(state: MatchState, winner: Slot | 'draw', reason: 'ko' | 'timeout' | 'doubleKo', events: GameEvent[]): void {
  state.phase = 'roundEnd';
  state.phaseFrame = 0;
  const perfect = winner !== 'draw' && state.fighters[winner].health === state.fighters[winner].maxHealth;
  if (winner !== 'draw') state.wins[winner]++;
  state.lastRound = { round: state.round, winner, reason, perfect };
  state.projectiles = [];
  events.push({ type: 'roundEnd', winner, reason, perfect });
}

function checkRoundOver(state: MatchState, events: GameEvent[]): void {
  if (state.phase !== 'fight') return;
  const [a, b] = state.fighters;
  const aDead = a.health <= 0;
  const bDead = b.health <= 0;
  if (aDead || bDead) {
    const winner: Slot | 'draw' = aDead && bDead ? 'draw' : aDead ? 1 : 0;
    events.push({ type: 'ko', loser: aDead && bDead ? 'both' : aDead ? 0 : 1 });
    endRound(state, winner, aDead && bDead ? 'doubleKo' : 'ko', events);
    return;
  }
  if (state.timer <= 0) {
    const ra = a.health / a.maxHealth;
    const rb = b.health / b.maxHealth;
    const winner: Slot | 'draw' = Math.abs(ra - rb) < 1e-9 ? 'draw' : ra > rb ? 0 : 1;
    events.push({ type: 'timeUp' });
    endRound(state, winner, 'timeout', events);
  }
}

/** Ends the match immediately (e.g. an online opponent forfeited). */
export function forfeitMatch(state: MatchState, winner: Slot): GameEvent[] {
  state.phase = 'matchEnd';
  state.phaseFrame = 0;
  state.matchWinner = winner;
  state.lastRound = { round: state.round, winner, reason: 'forfeit', perfect: false };
  state.fighters[winner].action = 'victory';
  state.fighters[winner].actionFrame = 0;
  return [{ type: 'matchEnd', winner }];
}

/**
 * Advances the match by one 60 Hz frame. Mutates `state` and returns the events that
 * happened this frame (hits, KOs, round changes) for rendering, audio and networking.
 */
export function stepMatch(state: MatchState, inputs: [number, number]): GameEvent[] {
  const events: GameEvent[] = [];
  state.frame++;
  state.phaseFrame++;

  if (state.phase === 'intro') {
    if (state.phaseFrame === 1) events.push({ type: 'roundStart', round: state.round });
    for (const f of state.fighters) {
      f.lastInput = sanitizeInput(inputs[state.fighters.indexOf(f)]);
      f.actionFrame++;
    }
    if (state.phaseFrame >= INTRO_FRAMES) {
      state.phase = 'fight';
      state.phaseFrame = 0;
      for (const f of state.fighters) {
        setAction(f, 'idle');
        f.buffer.fill(0);
      }
      events.push({ type: 'fight' });
    }
    return events;
  }

  if (state.phase === 'fight' && state.superFreeze > 0) {
    // Super flash: everything pauses except the super's owner finishing startup.
    state.superFreeze--;
    for (const i of [0, 1] as Slot[]) {
      const f = state.fighters[i];
      f.lastInput = sanitizeInput(inputs[i]);
    }
    if (state.superFreeze === 0) state.superOwner = -1;
    return events;
  }

  if (state.hitstop > 0) {
    state.hitstop--;
    // Keep buffering presses during hitstop so cancels feel responsive.
    for (const i of [0, 1] as Slot[]) {
      const f = state.fighters[i];
      const input = sanitizeInput(inputs[i]);
      const edges = input & ~f.lastInput;
      f.lastInput = input;
      f.buffer[0] |= edges;
    }
    return events;
  }

  const fighting = state.phase === 'fight';
  for (const i of [0, 1] as Slot[]) {
    if (fighting) handleInput(state, i, inputs[i], events);
    else {
      const f = state.fighters[i];
      f.lastInput = 0;
      if (ACTIONABLE.has(f.action)) {
        f.vx = 0;
        if (f.action !== 'idle' && f.action !== 'crouch') setAction(f, 'idle');
      }
    }
  }
  for (const i of [0, 1] as Slot[]) updateFighter(state, i, events);
  separate(state);
  updateFacing(state);
  updateProjectiles(state, events);

  if (fighting) {
    const hits = collectHits(state);
    for (const h of hits) applyHit(state, h, events);
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0 && p.x > -100 && p.x < 1060);

  // Combo counters reset once the defender recovers.
  for (const f of state.fighters) {
    if (f.action !== 'hitstun' && f.action !== 'knockdown') {
      f.comboHits = 0;
      f.comboDamage = 0;
    } else if (f.action === 'knockdown' && f.grounded) {
      f.comboHits = 0;
      f.comboDamage = 0;
    }
  }

  if (fighting) {
    state.timer = Math.max(0, state.timer - 1);
    checkRoundOver(state, events);
  } else if (state.phase === 'roundEnd') {
    roundEndFlow(state, events);
  } else if (state.phase === 'matchEnd') {
    victoryPoses(state);
  }
  return events;
}

function victoryPoses(state: MatchState): void {
  const lr = state.lastRound;
  if (!lr) return;
  for (const i of [0, 1] as Slot[]) {
    const f = state.fighters[i];
    if (f.airborne || f.action === 'victory' || f.action === 'timeoutLoss') continue;
    if (lr.winner === i && f.health > 0 && ACTIONABLE.has(f.action)) setAction(f, 'victory');
    if (lr.winner !== i && lr.winner !== 'draw' && lr.reason === 'timeout' && ACTIONABLE.has(f.action)) setAction(f, 'timeoutLoss');
  }
}

function roundEndFlow(state: MatchState, events: GameEvent[]): void {
  if (state.phaseFrame >= 50) victoryPoses(state);
  if (state.phaseFrame < ROUND_END_FRAMES) return;
  const [w0, w1] = state.wins;
  const need = state.config.roundsToWin;
  if (w0 >= need || w1 >= need || state.round >= MAX_ROUNDS) {
    state.phase = 'matchEnd';
    state.phaseFrame = 0;
    state.matchWinner = w0 === w1 ? 'draw' : w0 > w1 ? 0 : 1;
    events.push({ type: 'matchEnd', winner: state.matchWinner });
    return;
  }
  state.round++;
  state.phase = 'intro';
  state.phaseFrame = 0;
  resetForRound(state);
}

