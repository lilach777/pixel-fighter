import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode, type ErrorCode } from '../protocol';
import { randomInt } from './random';
import type { Player } from './player';
import { Room, type RoomOptions } from './room';

export function generateRoomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

export interface RoomManagerOptions extends RoomOptions {
  maxRooms: number;
  roomIdleMs: number;
  /** Room code source (default: random). Peer-to-peer hosts use their reserved code. */
  generateCode?: () => string;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private opts: RoomManagerOptions) {}

  create(p: Player): { ok: true; room: Room } | { ok: false; code: ErrorCode; message: string } {
    if (this.rooms.size >= this.opts.maxRooms) return { ok: false, code: 'server_full', message: 'Server is full. Try again later.' };
    this.leave(p);
    const gen = this.opts.generateCode ?? generateRoomCode;
    let code = gen();
    for (let i = 0; this.rooms.has(code) && i < 50; i++) code = gen();
    if (this.rooms.has(code)) return { ok: false, code: 'server_full', message: 'Could not allocate a room code.' };
    const room = new Room(code, this.opts);
    this.rooms.set(code, room);
    room.add(p);
    this.opts.log(`room ${code} created by ${p.name}`);
    return { ok: true, room };
  }

  join(p: Player, code: string): { ok: true; room: Room } | { ok: false; code: ErrorCode; message: string } {
    if (!isValidRoomCode(code)) return { ok: false, code: 'room_not_found', message: `Room "${code}" does not exist. Check the code and try again.` };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: 'room_not_found', message: `Room "${code}" does not exist. Check the code and try again.` };
    if (p.room === room) {
      room.broadcastRoom();
      return { ok: true, room };
    }
    if (room.playerCount >= 2) return { ok: false, code: 'room_full', message: 'That room is full (2/2 players).' };
    this.leave(p);
    room.add(p);
    this.opts.log(`room ${code}: ${p.name} joined`);
    return { ok: true, room };
  }

  leave(p: Player, reason: 'leave' | 'timeout' = 'leave'): void {
    const room = p.room;
    if (!room) return;
    room.remove(p, reason);
    if (room.isEmpty()) this.delete(room);
  }

  delete(room: Room): void {
    this.rooms.delete(room.code);
    this.opts.log(`room ${room.code} closed`);
  }

  tick(): void {
    for (const room of this.rooms.values()) {
      room.tick();
      // Rooms whose players all timed out become empty during tick.
      if (room.isEmpty()) this.delete(room);
    }
  }

  /** Removes rooms with no activity for roomIdleMs (abandoned lobbies). */
  cleanup(): void {
    const now = this.opts.now();
    for (const room of [...this.rooms.values()]) {
      const active = room.phase === 'playing' || room.phase === 'paused';
      if (!active && now - room.lastActivity > this.opts.roomIdleMs) {
        for (const p of room.players) if (p) room.remove(p, 'timeout');
        this.delete(room);
      }
    }
  }
}
