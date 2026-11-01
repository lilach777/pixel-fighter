import { TICK_MS } from '../constants';
import { PROTOCOL_VERSION, parseClientMessage, sanitizeName, type ClientMessage, type ErrorCode } from '../protocol';
import { Player, type Transport } from './player';
import { TokenBucket } from './rateLimit';
import { RoomManager, type RoomManagerOptions } from './roomManager';

/**
 * The authoritative game "server" logic, independent of the network transport.
 *
 * Used by the Node WebSocket server (server/src/networking/gameServer.ts) and, for
 * peer-to-peer play, inside the host player's browser (client/src/multiplayer/p2p.ts).
 * Each connection gets the same validation, rate limiting and room handling either way.
 */
export interface HubOptions extends RoomManagerOptions {
  reconnectGraceMs: number;
}

export interface HubConnection {
  /** Feed one received message. `isBinary` true rejects it (text JSON only). */
  message(text: string, isBinary?: boolean): void;
  /** The transport closed. */
  close(): void;
}

const MAX_STRIKES = 20;

export class GameHub {
  readonly rooms: RoomManager;
  private byToken = new Map<string, Player>();
  private stopLoop: (() => void) | null = null;

  constructor(private opts: HubOptions) {
    this.rooms = new RoomManager(opts);
  }

  get playerCount(): number {
    return this.byToken.size;
  }

  /** Wires a new connection; the transport layer calls the returned handlers. */
  connect(transport: Transport): HubConnection {
    const { opts, rooms, byToken } = this;
    // Room create/join attempts are limited separately so room codes cannot be
    // brute-forced: 6 quick attempts, then one every 3 seconds.
    const joinBucket = new TokenBucket(6, 1 / 3);
    const bucket = new TokenBucket(150, 100);
    let player: Player | null = null;
    let strikes = 0;

    const sendRaw = (obj: unknown) => {
      if (transport.isOpen()) transport.send(JSON.stringify(obj));
    };
    const error = (code: ErrorCode, message: string) => sendRaw({ t: 'error', code, message });
    const strike = (why: string) => {
      strikes++;
      error('bad_message', why);
      if (strikes >= MAX_STRIKES) transport.close(1008, 'too many invalid messages');
    };

    const handle = (msg: ClientMessage): void => {
      if (msg.t === 'ping') {
        sendRaw({ t: 'pong', ts: msg.ts, serverTime: Date.now() });
        return;
      }
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL_VERSION) {
          error('version_mismatch', `Client protocol v${msg.v} is not supported (server v${PROTOCOL_VERSION}). Refresh the page.`);
          transport.close(1008, 'version mismatch');
          return;
        }
        if (player) return; // duplicate hello
        const resumed = msg.resume ? byToken.get(msg.resume) : undefined;
        if (resumed && !resumed.connected) {
          player = resumed;
          player.transport = transport;
          opts.log(`player ${player.name} resumed`);
          sendRaw({ t: 'welcome', v: PROTOCOL_VERSION, playerId: player.id, resume: player.token, serverTime: Date.now() });
          player.room?.onReconnect(player);
          return;
        }
        player = new Player();
        player.name = sanitizeName(msg.name);
        player.transport = transport;
        byToken.set(player.token, player);
        sendRaw({ t: 'welcome', v: PROTOCOL_VERSION, playerId: player.id, resume: player.token, serverTime: Date.now() });
        return;
      }
      if (!player) {
        strike('send hello first');
        return;
      }
      const p = player;
      switch (msg.t) {
        case 'createRoom':
        case 'joinRoom':
          if (!joinBucket.take()) {
            error('rate_limited', 'Too many room attempts. Wait a few seconds and try again.');
            return;
          }
      }
      switch (msg.t) {
        case 'createRoom': {
          if (msg.name !== undefined) p.name = sanitizeName(msg.name);
          const r = rooms.create(p);
          if (!r.ok) error(r.code, r.message);
          return;
        }
        case 'joinRoom': {
          if (msg.name !== undefined) p.name = sanitizeName(msg.name);
          const r = rooms.join(p, msg.code);
          if (!r.ok) error(r.code, r.message);
          return;
        }
        case 'leaveRoom':
          if (!p.room) {
            sendRaw({ t: 'left' });
            return;
          }
          rooms.leave(p);
          return;
      }
      const room = p.room;
      if (!room) {
        error('not_in_room', 'Join or create a room first.');
        return;
      }
      let problem: string | null = null;
      switch (msg.t) {
        case 'selectCharacter':
          problem = room.selectCharacter(p, msg.char);
          break;
        case 'ready':
          problem = room.setReady(p, msg.ready);
          break;
        case 'rematch':
          problem = room.voteRematch(p, msg.vote);
          break;
        case 'input':
          if (room.phase === 'playing') room.setInput(p, msg.seq, msg.bits);
          break;
      }
      if (problem) error('invalid_state', problem);
    };

    return {
      message: (text, isBinary = false) => {
        if (isBinary) return strike('binary frames are not supported');
        if (!bucket.take()) {
          error('rate_limited', 'Too many messages.');
          strikes += 0.25;
          if (strikes >= MAX_STRIKES) transport.close(1008, 'rate limit');
          return;
        }
        const parsed = parseClientMessage(text);
        if (!parsed.ok) return strike(parsed.error);
        handle(parsed.msg);
      },
      close: () => {
        if (!player || player.transport !== transport) return;
        player.transport = null;
        const p = player;
        if (p.room) {
          const inMatch = p.room.phase === 'playing' || p.room.phase === 'paused';
          if (inMatch) {
            p.room.onDisconnect(p);
            // The room's grace timer decides; drop the identity afterwards.
            setTimeout(() => {
              if (!p.connected && !p.room) byToken.delete(p.token);
            }, opts.reconnectGraceMs + 1000);
          } else {
            // Outside a match a dropped player gives up their seat shortly after.
            p.room.onDisconnect(p);
            setTimeout(() => {
              if (!p.connected) {
                rooms.leave(p, 'timeout');
                byToken.delete(p.token);
              }
            }, Math.min(opts.reconnectGraceMs, 10000));
          }
        } else {
          byToken.delete(p.token);
        }
      },
    };
  }

  /**
   * Starts the drift-corrected 60 Hz loop that steps every room, plus idle-room cleanup.
   * Idempotent; `stop()` ends both.
   */
  start(): void {
    if (this.stopLoop) return;
    let next = performance.now();
    let running = true;
    const loop = () => {
      if (!running) return;
      const t = performance.now();
      let steps = 0;
      while (t >= next && steps < 5) {
        this.rooms.tick();
        next += TICK_MS;
        steps++;
      }
      if (t - next > 250) next = t; // fell far behind (debugger/sleep/background tab): resync
      setTimeout(loop, Math.max(1, next - performance.now()));
    };
    setTimeout(loop, 0);
    const cleanupTimer = setInterval(() => this.rooms.cleanup(), 30000);
    this.stopLoop = () => {
      running = false;
      clearInterval(cleanupTimer);
    };
  }

  stop(): void {
    this.stopLoop?.();
    this.stopLoop = null;
  }
}
