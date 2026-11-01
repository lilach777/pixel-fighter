import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../../../shared/src/protocol';
import { GameHub } from '../../../shared/src/net/hub';
import type { Transport } from '../../../shared/src/net/player';
import type { RoomOptions } from '../../../shared/src/net/room';
import type { RoomManager } from '../../../shared/src/net/roomManager';
import { resolveClientIp, type ClientIpPolicy } from '../security/clientIp';
import { makeOriginCheck } from '../security/origin';

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
  const hub = new GameHub({
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
    const conn = hub.connect(new WsTransport(ws));
    let alive = true;

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

    ws.on('message', (data, isBinary) => conn.message(data.toString(), isBinary));
    ws.on('close', () => {
      connections--;
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      clearInterval(heartbeat);
      conn.close();
    });
  });

  hub.start();

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  opts.log(`listening on http://${opts.host}:${port} (ws path /ws, origins: ${opts.allowedOrigins.join(', ')})`);

  return {
    port,
    rooms: hub.rooms,
    stats: () => ({ rooms: hub.rooms.rooms.size, connections, players: hub.playerCount }),
    close: async () => {
      hub.stop();
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
