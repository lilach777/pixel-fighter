import type { Slot } from '../engine/state';
import type { ServerMessage } from '../protocol';
import { randomId, randomToken } from './random';
import type { Room } from './room';

export interface Transport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
}

/** A player identity. Survives socket drops (rebound via the resume token). */
export class Player {
  readonly id = randomId();
  readonly token = randomToken(18);
  name = 'Player';
  transport: Transport | null = null;
  room: Room | null = null;
  slot: Slot = 0;
  char: string | null = null;
  ready = false;
  rematch = false;
  input = 0;
  lastSeq = 0;
  lastInputAt = 0;
  /** Set when the socket dropped; cleared on resume. */
  disconnectedAt: number | null = null;

  get connected(): boolean {
    return this.transport !== null && this.transport.isOpen();
  }

  send(msg: ServerMessage): void {
    if (this.transport?.isOpen()) this.transport.send(JSON.stringify(msg));
  }

  resetForLobby(): void {
    this.ready = false;
    this.rematch = false;
    this.input = 0;
    this.lastSeq = 0;
  }
}
