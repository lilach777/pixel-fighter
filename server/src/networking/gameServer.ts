import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_MS } from '../../../shared/src/constants';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  sanitizeName,
  type ClientMessage,
  type ErrorCode,
} from '../../../shared/src/protocol';
import { Player, type Transport } from '../rooms/player';
import type { RoomOptions } from '../rooms/room';
import { RoomManager } from '../rooms/roomManager';
import { resolveClientIp, type ClientIpPolicy } from '../security/clientIp';
import { makeOriginCheck } from '../security/origin';
import { TokenBucket } from '../security/rateLimit';

export interface GameServerOptions {
  port: number;
  host: string;
  allowedOrigins: string[];
  /** Directory of the built client to serve (optional single-service deployment). */
  clientDist: string | null;
  snapshotEvery: number;
  reconnectGraceMs: number;
  countdownMs: number;
  roomIdleMs: number;
  maxRooms: number;
  maxConnections: number;
  /** Simultaneous WebSocket connections allowed from one client IP. */
  maxConnectionsPerIp: number;
  /** How the client IP is determined for the per-IP limit (see security/clientIp.ts). */
  clientIpPolicy: ClientIpPolicy;
  speed: number;
  match: RoomOptions['match'];
  log: (msg: string) => void;
}

export const DEFAULT_OPTIONS: GameServerOptions = {
  port: 8787,
  host: '0.0.0.0',
  allowedOrigins: ['*'],
  clientDist: null,
  snapshotEvery: 2,
  reconnectGraceMs: 20000,
  countdownMs: 3000,
  roomIdleMs: 15 * 60 * 1000,
  maxRooms: 500,
  maxConnections: 2000,
  maxConnectionsPerIp: 16,
  clientIpPolicy: { mode: 'off' },
  speed: 1,
  match: {},
  log: (m) => console.log(`[server] ${m}`),
};

const MAX_STRIKES = 20;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface GameServer {
  port: number;
  rooms: RoomManager;
  close(): Promise<void>;
  stats(): { rooms: number; connections: number; players: number };
}

class WsTransport implements Transport {
  constructor(private ws: WebSocket) {}
  send(data: string): void {
    this.ws.send(data);
  }
  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
  isOpen(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }
}

export async function createGameServer(partial: Partial<GameServerOptions> = {}): Promise<GameServer> {
  const opts: GameServerOptions = { ...DEFAULT_OPTIONS, ...partial };
  const now = () => Date.now();
  const rooms = new RoomManager({
    snapshotEvery: opts.snapshotEvery,
    reconnectGraceMs: opts.reconnectGraceMs,
    countdownMs: opts.countdownMs,
    inputStaleMs: 600,
    speed: opts.speed,
    postMatchFrames: 300,
    match: opts.match,
    now,
    log: opts.log,
    maxRooms: opts.maxRooms,
    roomIdleMs: opts.roomIdleMs,
  });
  const byToken = new Map<string, Player>();
  const originOk = makeOriginCheck(opts.allowedOrigins);
  let connections = 0;
  const perIp = new Map<string, number>();
  const clientIp = (req: http.IncomingMessage): string => resolveClientIp({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, opts.clientIpPolicy);

  // ------------------------------------------------------------------ HTTP
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      // Minimal by design: liveness and protocol version only (no load figures, no CORS).
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION }));
      return;
    }
    if (opts.clientDist) {
      serveStatic(opts.clientDist, url.pathname, res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Pixel Fighters game server. WebSocket endpoint: /ws  Health: /health\n');
  });

  // ------------------------------------------------------------------ WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES * 2 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!originOk(req.headers.origin, req.headers.host)) {
      opts.log(`rejected origin ${req.headers.origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const reqIp = clientIp(req);
    if ((perIp.get(reqIp) ?? 0) >= opts.maxConnectionsPerIp) {
      opts.log(`per-IP connection limit reached for ${reqIp}`);
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    if (connections >= opts.maxConnections) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    connections++;
    const ip = clientIp(req);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    // Room create/join attempts are limited separately so room codes cannot be
    // brute-forced: 6 quick attempts, then one every 3 seconds.
    const joinBucket = new TokenBucket(6, 1 / 3);
    const transport = new WsTransport(ws);
    const bucket = new TokenBucket(150, 100);
    let player: Player | null = null;
    let strikes = 0;
    let alive = true;

    const sendRaw = (obj: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };
    const error = (code: ErrorCode, message: string) => sendRaw({ t: 'error', code, message });
    const strike = (why: string) => {
      strikes++;
      error('bad_message', why);
      if (strikes >= MAX_STRIKES) ws.close(1008, 'too many invalid messages');
    };

    ws.on('pong', () => {
      alive = true;
    });
    // Oversized frames / protocol errors surface here; without a listener they would
    // crash the process. The socket is closed by `ws` afterwards.
    ws.on('error', (err) => {
      opts.log(`socket error: ${err.message}`);
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 15000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return strike('binary frames are not supported');
      if (!bucket.take()) {
        error('rate_limited', 'Too many messages.');
        strikes += 0.25;
        if (strikes >= MAX_STRIKES) ws.close(1008, 'rate limit');
        return;
      }
      const text = data.toString();
      const parsed = parseClientMessage(text);
      if (!parsed.ok) return strike(parsed.error);
      handle(parsed.msg);
    });

    ws.on('close', () => {
      connections--;
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      clearInterval(heartbeat);
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
    });

    function handle(msg: ClientMessage): void {
      if (msg.t === 'ping') {
        sendRaw({ t: 'pong', ts: msg.ts, serverTime: Date.now() });
        return;
      }
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL_VERSION) {
          error('version_mismatch', `Client protocol v${msg.v} is not supported (server v${PROTOCOL_VERSION}). Refresh the page.`);
          ws.close(1008, 'version mismatch');
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
    }
  });

  // ------------------------------------------------------------------ loop
  // Drift-corrected fixed-rate loop: steps every room once per 1/60 s of real time.
  let next = performance.now();
  let running = true;
  const loop = () => {
    if (!running) return;
    const t = performance.now();
    let steps = 0;
    while (t >= next && steps < 5) {
      rooms.tick();
      next += TICK_MS;
      steps++;
    }
    if (t - next > 250) next = t; // fell far behind (debugger/sleep): resync
    setTimeout(loop, Math.max(1, next - performance.now()));
  };
  setTimeout(loop, 0);
  const cleanupTimer = setInterval(() => rooms.cleanup(), 30000);

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  opts.log(`listening on http://${opts.host}:${port} (ws path /ws, origins: ${opts.allowedOrigins.join(', ')})`);

  return {
    port,
    rooms,
    stats: () => ({ rooms: rooms.rooms.size, connections, players: byToken.size }),
    close: async () => {
      running = false;
      clearInterval(cleanupTimer);
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/**
 * Maps a URL path to a file inside `root`, or null if it would escape the root.
 * `root` may be relative (resolved against the working directory).
 */
export function resolveStaticPath(root: string, pathname: string): string | null {
  const base = path.resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const safe = path.normalize(decoded).replace(/^([/\\])+/, '');
  const file = path.resolve(base, safe);
  const rel = path.relative(base, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

function serveStatic(root: string, pathname: string, res: http.ServerResponse): void {
  const resolved = resolveStaticPath(root, pathname);
  if (!resolved) {
    res.writeHead(403);
    res.end();
    return;
  }
  let file = resolved;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(path.resolve(root), 'index.html');
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`) && /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}
