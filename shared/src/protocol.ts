/**
 * Pixel Fighters online protocol (JSON over WebSocket). See docs/PROTOCOL.md.
 * Bump PROTOCOL_VERSION on any incompatible change; the server rejects mismatches.
 */
import { isCharacterId } from './characters/roster';
import type { GameEvent } from './engine/sim';
import type { FighterView, MatchState, Slot } from './engine/state';
import { INPUT_MASK } from './input';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 2048;
export const ROOM_CODE_LENGTH = 5;
/** Unambiguous alphabet (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_NAME_LENGTH = 16;

// ---------------------------------------------------------------- client -> server
export type ClientMessage =
  | { t: 'hello'; v: number; name?: string; resume?: string }
  | { t: 'createRoom'; name?: string }
  | { t: 'joinRoom'; code: string; name?: string }
  | { t: 'selectCharacter'; char: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; seq: number; bits: number }
  | { t: 'rematch'; vote: boolean }
  | { t: 'leaveRoom' }
  | { t: 'ping'; ts: number };

// ---------------------------------------------------------------- server -> client
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'finished';

export interface RoomPlayer {
  slot: Slot;
  name: string;
  char: string | null;
  ready: boolean;
  connected: boolean;
  rematch: boolean;
}

export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  players: RoomPlayer[];
  /** Server time (ms) when the countdown ends / reconnect grace expires, if relevant. */
  deadline: number | null;
}

export type ErrorCode =
  | 'bad_message'
  | 'version_mismatch'
  | 'room_not_found'
  | 'room_full'
  | 'not_in_room'
  | 'invalid_state'
  | 'rate_limited'
  | 'server_full';

export type ServerMessage =
  | { t: 'welcome'; v: number; playerId: string; resume: string; serverTime: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'room'; you: Slot; room: RoomInfo }
  | { t: 'left' }
  | { t: 'matchStart'; matchId: number; chars: [string, string]; you: Slot }
  | { t: 'snapshot'; matchId: number; frame: number; ack: number; state: NetState; events: GameEvent[] }
  | { t: 'matchEnd'; matchId: number; winner: Slot | 'draw'; reason: string }
  | { t: 'opponentStatus'; connected: boolean; graceMs: number }
  | { t: 'pong'; ts: number; serverTime: number };

/** Snapshot payload: the match state minus per-fighter input buffers. */
export type NetState = Omit<MatchState, 'fighters'> & {
  fighters: [NetFighter, NetFighter];
};
export type NetFighter = FighterView;

export function toNetState(s: MatchState): NetState {
  const strip = (f: MatchState['fighters'][number]): NetFighter => {
    const { buffer: _b, lastInput: _l, tapDir: _t, tapAge: _a, ...rest } = f;
    void _b;
    void _l;
    void _t;
    void _a;
    return rest;
  };
  return { ...s, fighters: [strip(s.fighters[0]), strip(s.fighters[1])] };
}

// ---------------------------------------------------------------- validation
export type Validation<T> = { ok: true; msg: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function isValidRoomCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((c) => ROOM_CODE_ALPHABET.includes(c))
  );
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'Player';
  const clean = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || 'Player';
}

/** Strictly validates a parsed client message. Unknown fields are rejected. */
export function validateClientMessage(raw: unknown): Validation<ClientMessage> {
  if (!isObj(raw) || typeof raw.t !== 'string') return { ok: false, error: 'message must be an object with a string "t"' };
  const keys = Object.keys(raw);
  const only = (...allowed: string[]) => keys.every((k) => k === 't' || allowed.includes(k));
  switch (raw.t) {
    case 'hello':
      if (!only('v', 'name', 'resume')) return { ok: false, error: 'unexpected fields' };
      if (!isInt(raw.v)) return { ok: false, error: 'v must be an integer' };
      if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > 64)) return { ok: false, error: 'bad name' };
      if (raw.resume !== undefined && (typeof raw.resume !== 'string' || raw.resume.length > 64)) return { ok: false, error: 'bad resume token' };
      return { ok: true, msg: { t: 'hello', v: raw.v, name: raw.name as string | undefined, resume: raw.resume as string | undefined } };
    case 'leaveRoom':
      if (!only()) return { ok: false, error: 'unexpected fields' };
      return { ok: true, msg: { t: 'leaveRoom' } };
    case 'createRoom':
      if (!only('name')) return { ok: false, error: 'unexpected fields' };
      if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > 64)) return { ok: false, error: 'bad name' };
      return { ok: true, msg: { t: 'createRoom', name: raw.name as string | undefined } };
    case 'joinRoom':
      if (!only('code', 'name')) return { ok: false, error: 'unexpected fields' };
      if (typeof raw.code !== 'string' || raw.code.length > 12) return { ok: false, error: 'bad room code' };
      if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > 64)) return { ok: false, error: 'bad name' };
      return { ok: true, msg: { t: 'joinRoom', code: normalizeRoomCode(raw.code), name: raw.name as string | undefined } };
    case 'selectCharacter':
      if (!only('char')) return { ok: false, error: 'unexpected fields' };
      if (!isCharacterId(raw.char)) return { ok: false, error: 'unknown character' };
      return { ok: true, msg: { t: 'selectCharacter', char: raw.char } };
    case 'ready':
      if (!only('ready') || typeof raw.ready !== 'boolean') return { ok: false, error: 'ready must be boolean' };
      return { ok: true, msg: { t: 'ready', ready: raw.ready } };
    case 'input':
      if (!only('seq', 'bits')) return { ok: false, error: 'unexpected fields' };
      if (!isInt(raw.seq) || raw.seq < 0 || raw.seq > 2 ** 31) return { ok: false, error: 'bad seq' };
      if (!isInt(raw.bits) || raw.bits < 0 || (raw.bits & ~INPUT_MASK) !== 0) return { ok: false, error: 'bad input bits' };
      return { ok: true, msg: { t: 'input', seq: raw.seq, bits: raw.bits } };
    case 'rematch':
      if (!only('vote') || typeof raw.vote !== 'boolean') return { ok: false, error: 'vote must be boolean' };
      return { ok: true, msg: { t: 'rematch', vote: raw.vote } };
    case 'ping':
      if (!only('ts') || typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) return { ok: false, error: 'bad ts' };
      return { ok: true, msg: { t: 'ping', ts: raw.ts } };
    default:
      return { ok: false, error: `unknown message type` };
  }
}

/** Parses and validates a raw frame (string or bytes) with the size limit applied. */
export function parseClientMessage(data: string): Validation<ClientMessage> {
  if (data.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  return validateClientMessage(parsed);
}
