import fs from 'node:fs';
import path from 'node:path';
import { createGameServer, DEFAULT_OPTIONS } from './networking/gameServer';
import { parseClientIpPolicy, type ClientIpPolicy } from './security/clientIp';
import { resolveAllowedOrigins } from './security/origin';

/** Environment-driven entry point. See .env.example and docs/DEPLOYMENT.md. */
// Load a local .env for development (real environment variables take precedence).
const envFile = path.resolve(import.meta.dirname, '..', '..', '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn(`[server] could not read .env: ${(e as Error).message}`);
  }
}
const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

const distGuess = path.resolve(import.meta.dirname, '..', '..', 'client', 'dist');
// CLIENT_DIST may be relative; resolve it once against the working directory.
const clientDist = env.CLIENT_DIST ? path.resolve(env.CLIENT_DIST) : distGuess;
const serveClient = env.SERVE_CLIENT === 'true' || (env.SERVE_CLIENT !== 'false' && fs.existsSync(path.join(clientDist, 'index.html')) && env.NODE_ENV === 'production');

let allowedOrigins: string[];
let clientIpPolicy: ClientIpPolicy;
try {
  allowedOrigins = resolveAllowedOrigins(env.ALLOWED_ORIGINS, env.NODE_ENV);
  clientIpPolicy = parseClientIpPolicy(env.TRUST_PROXY, env.TRUSTED_PROXIES);
} catch (e) {
  console.error(`[server] ${(e as Error).message}`);
  process.exit(1);
}

const server = await createGameServer({
  port: num(env.PORT, DEFAULT_OPTIONS.port),
  host: env.HOST ?? DEFAULT_OPTIONS.host,
  allowedOrigins,
  clientDist: serveClient ? clientDist : null,
  snapshotEvery: Math.max(1, Math.round(60 / num(env.SNAPSHOT_HZ, 30))),
  reconnectGraceMs: num(env.RECONNECT_GRACE_MS, DEFAULT_OPTIONS.reconnectGraceMs),
  countdownMs: num(env.COUNTDOWN_MS, DEFAULT_OPTIONS.countdownMs),
  roomIdleMs: num(env.ROOM_IDLE_MS, DEFAULT_OPTIONS.roomIdleMs),
  maxRooms: num(env.MAX_ROOMS, DEFAULT_OPTIONS.maxRooms),
  maxConnections: num(env.MAX_CONNECTIONS, DEFAULT_OPTIONS.maxConnections),
  maxConnectionsPerIp: num(env.MAX_CONNECTIONS_PER_IP, DEFAULT_OPTIONS.maxConnectionsPerIp),
  clientIpPolicy,
  match: {
    roundSeconds: num(env.ROUND_SECONDS, 60),
    roundsToWin: num(env.ROUNDS_TO_WIN, 2),
  },
});

if (serveClient) console.log('[server] serving built client');
console.log(`[server] client IP source: ${clientIpPolicy.mode === 'xff' ? `X-Forwarded-For via trusted proxies ${clientIpPolicy.trustedList.join(', ')}` : clientIpPolicy.mode === 'cloudflare' ? 'CF-Connecting-IP (Cloudflare edge)' : 'TCP peer address'}`);
const shutdown = () => {
  console.log('[server] shutting down');
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
