import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Btn } from '../../shared/src/input';
import { isValidRoomCode, type ServerMessage } from '../../shared/src/protocol';
import { createGameServer, type GameServer } from '../../server/src/networking/gameServer';
import { parseClientIpPolicy } from '../../server/src/security/clientIp';
import { TestClient, sleep } from './wsClient';

type RoomMsg = Extract<ServerMessage, { t: 'room' }>;
type SnapMsg = Extract<ServerMessage, { t: 'snapshot' }>;

let server: GameServer;
const clients: TestClient[] = [];

beforeAll(async () => {
  server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    countdownMs: 150,
    reconnectGraceMs: 1200,
    speed: 4, // fast-forward the authoritative simulation 4x for test speed
    match: { roundSeconds: 99, roundsToWin: 2 },
    log: () => undefined,
  });
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function client(name: string, resume?: string): Promise<TestClient> {
  const c = await TestClient.connect(server.port, name, resume);
  clients.push(c);
  return c;
}

async function roomWithTwo(): Promise<{ a: TestClient; b: TestClient; code: string }> {
  const a = await client('Alice');
  a.send({ t: 'createRoom' });
  const r = await a.wait<RoomMsg>((m) => m.t === 'room');
  const b = await client('Bob');
  const joinedA = a.wait<RoomMsg>((m) => m.t === 'room' && m.room.players.length === 2);
  b.send({ t: 'joinRoom', code: r.room.code });
  await b.wait<RoomMsg>((m) => m.t === 'room' && m.room.players.length === 2);
  await joinedA;
  return { a, b, code: r.room.code };
}

async function startMatch(charA = 'joshua', charB = 'jeremy') {
  const { a, b, code } = await roomWithTwo();
  a.send({ t: 'selectCharacter', char: charA });
  b.send({ t: 'selectCharacter', char: charB });
  const startA = a.wait<Extract<ServerMessage, { t: 'matchStart' }>>((m) => m.t === 'matchStart');
  const startB = b.wait<Extract<ServerMessage, { t: 'matchStart' }>>((m) => m.t === 'matchStart');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  const [sa, sb] = await Promise.all([startA, startB]);
  return { a, b, code, sa, sb };
}

/** Bot for client A: walks to the opponent and repeatedly presses heavy punch. */
function aggressor(c: TestClient, slot: 0 | 1): () => void {
  let frame = 0;
  const t = setInterval(() => {
    frame++;
    const s = c.latestState;
    if (!s || s.phase !== 'fight') {
      c.input(0);
      return;
    }
    const me = s.fighters[slot];
    const opp = s.fighters[1 - slot];
    const toward = opp.x > me.x ? Btn.RIGHT : Btn.LEFT;
    if (Math.abs(opp.x - me.x) > 95) c.input(toward);
    else c.input(frame % 4 === 0 ? Btn.HP : 0);
  }, 8);
  return () => clearInterval(t);
}

describe('rooms', () => {
  it('1. creates a room with a human-readable code', async () => {
    const a = await client('Alice');
    a.send({ t: 'createRoom' });
    const r = await a.wait<RoomMsg>((m) => m.t === 'room');
    expect(isValidRoomCode(r.room.code)).toBe(true);
    expect(r.room.phase).toBe('lobby');
    expect(r.room.players).toHaveLength(1);
    expect(r.you).toBe(0);
  });

  it('2. joins with a valid room code', async () => {
    const { a, b, code } = await roomWithTwo();
    expect(a.lastRoom()!.room.code).toBe(code);
    expect(b.lastRoom()!.you).toBe(1);
    expect(b.lastRoom()!.room.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('3. rejects an invalid or unknown room code', async () => {
    const c = await client('Carol');
    c.send({ t: 'joinRoom', code: 'ZZZZ9' });
    const e1 = await c.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e1.code).toBe('room_not_found');
    c.send({ t: 'joinRoom', code: 'ab!' });
    const e2 = await c.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error' && m !== e1);
    expect(e2.code).toBe('room_not_found');
  });

  it('4. rejects a third player', async () => {
    const { code } = await roomWithTwo();
    const c = await client('Carol');
    c.send({ t: 'joinRoom', code });
    const e = await c.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e.code).toBe('room_full');
  });

  it('5. requires both players to be ready before starting', async () => {
    const { a, b } = await roomWithTwo();
    a.send({ t: 'ready', ready: true });
    const e = await a.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e.message).toMatch(/fighter/i);
    a.send({ t: 'selectCharacter', char: 'rick' });
    b.send({ t: 'selectCharacter', char: 'migo' });
    a.send({ t: 'ready', ready: true });
    await a.wait<RoomMsg>((m) => m.t === 'room' && m.room.players.some((p) => p.slot === 0 && p.ready));
    await sleep(300);
    expect(a.messages.some((m) => m.t === 'matchStart')).toBe(false);
    expect(a.lastRoom()!.room.phase).toBe('lobby');
    const start = b.wait((m) => m.t === 'matchStart');
    b.send({ t: 'ready', ready: true });
    await b.untilRoom((m) => m.room.phase === 'countdown');
    await start;
  });

  it('rejects a character id that is not in the roster', async () => {
    const { a } = await roomWithTwo();
    a.send({ t: 'selectCharacter', char: 'not-a-fighter' });
    const e = await a.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e.code).toBe('bad_message');
    expect(a.lastRoom()!.room.players.find((p) => p.slot === 0)!.char).toBeNull();
    a.send({ t: 'ready', ready: true });
    const e2 = await a.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error' && m !== e);
    expect(e2.message).toMatch(/fighter/i);
  });

  it('cleans up an empty room after both leave', async () => {
    const { a, b, code } = await roomWithTwo();
    a.send({ t: 'leaveRoom' });
    await a.wait((m) => m.t === 'left');
    await b.untilRoom((m) => m.room.players.length === 1);
    b.send({ t: 'leaveRoom' });
    await b.wait((m) => m.t === 'left');
    await sleep(50);
    expect(server.rooms.rooms.has(code)).toBe(false);
  });
});

describe('authoritative match', () => {
  it('6. synchronizes player movement to both clients', async () => {
    const { a, b } = await startMatch();
    await a.wait<SnapMsg>((m) => m.t === 'snapshot' && m.state.phase === 'fight', 10000);
    const x0 = a.latestState!.fighters[0].x;
    const hold = setInterval(() => a.input(Btn.RIGHT), 10);
    await sleep(400);
    clearInterval(hold);
    a.input(0);
    await sleep(150);
    const fa = a.latestState!.fighters[0];
    expect(fa.x).toBeGreaterThan(x0 + 20);
    // B sees the same authoritative position for the same frame.
    const frame = Math.min(a.latestFrame, b.latestFrame);
    const sa = a.messages.find((m): m is SnapMsg => m.t === 'snapshot' && m.frame === frame);
    const sb = b.messages.find((m): m is SnapMsg => m.t === 'snapshot' && m.frame === frame);
    expect(sa && sb).toBeTruthy();
    expect(sb!.state.fighters[0].x).toBe(sa!.state.fighters[0].x);
  });

  it('7-8. registers attacks and damage and updates health identically on both clients', async () => {
    const { a, b } = await startMatch();
    await a.wait<SnapMsg>((m) => m.t === 'snapshot' && m.state.phase === 'fight', 10000);
    const stop = aggressor(a, 0);
    const hitB = b.wait<SnapMsg>((m) => m.t === 'snapshot' && m.events.some((e) => e.type === 'hit' && e.attacker === 0), 10000);
    await hitB;
    stop();
    await sleep(200);
    const frame = Math.min(a.latestFrame, b.latestFrame);
    const sa = a.messages.find((m): m is SnapMsg => m.t === 'snapshot' && m.frame === frame)!;
    const sb = b.messages.find((m): m is SnapMsg => m.t === 'snapshot' && m.frame === frame)!;
    expect(sb.state.fighters[1].health).toBeLessThan(sb.state.fighters[1].maxHealth);
    expect(sa.state.fighters[1].health).toBe(sb.state.fighters[1].health);
    expect(sa.state.fighters[0].meter).toBe(sb.state.fighters[0].meter);
  });

  it('ignores client attempts to dictate state (only inputs are accepted)', async () => {
    const { a } = await startMatch();
    a.send({ t: 'snapshot', state: { fighters: [{ health: 1 }, { health: 0 }] } });
    const e = await a.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e.code).toBe('bad_message');
    a.send({ t: 'input', seq: 1, bits: 1 << 12 });
    const e2 = await a.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error' && m !== e);
    expect(e2.code).toBe('bad_message');
  });

  it('9-10. completes networked rounds and the full match, then 12. supports rematch voting', async () => {
    const { a, b, sa } = await startMatch('joshua', 'koala');
    const stop = aggressor(a, 0);
    const roundEnd = b.wait<SnapMsg>((m) => m.t === 'snapshot' && m.events.some((e) => e.type === 'roundEnd'), 30000);
    await roundEnd;
    const endA = a.wait<Extract<ServerMessage, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd', 60000);
    const endB = b.wait<Extract<ServerMessage, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd', 60000);
    const [ea, eb] = await Promise.all([endA, endB]);
    stop();
    expect(ea.winner).toBe(0);
    expect(eb.winner).toBe(0);
    expect(ea.matchId).toBe(sa.matchId);
    await b.untilRoom((m) => m.room.phase === 'finished');
    expect(b.latestState!.wins[0]).toBe(2);

    // Rematch: both must vote.
    a.send({ t: 'rematch', vote: true });
    await b.wait<RoomMsg>((m) => m.t === 'room' && m.room.players.some((p) => p.slot === 0 && p.rematch));
    expect(b.messages.filter((m) => m.t === 'matchStart')).toHaveLength(1);
    const next = b.wait<Extract<ServerMessage, { t: 'matchStart' }>>((m) => m.t === 'matchStart');
    b.send({ t: 'rematch', vote: true });
    const n = await next;
    expect(n.matchId).toBe(sa.matchId + 1);
  }, 90000);

  it('11. handles disconnects: pauses, resumes on reconnect, forfeits after the grace period', async () => {
    const { a, b } = await startMatch();
    await a.wait<SnapMsg>((m) => m.t === 'snapshot' && m.state.phase === 'fight', 10000);
    const resume = b.resume;
    const paused = a.wait<Extract<ServerMessage, { t: 'opponentStatus' }>>((m) => m.t === 'opponentStatus' && !m.connected);
    await b.close();
    await paused;
    await a.untilRoom((m) => m.room.phase === 'paused');
    const frameAtPause = a.latestFrame;
    await sleep(200);
    expect(a.latestFrame).toBe(frameAtPause); // simulation halted while paused

    // Reconnect with the resume token -> same seat, match continues.
    const back = await client('Bob', resume);
    const restart = await back.wait<Extract<ServerMessage, { t: 'matchStart' }>>((m) => m.t === 'matchStart');
    expect(restart.you).toBe(1);
    await a.untilRoom((m) => m.room.phase === 'playing');
    await a.wait<SnapMsg>((m) => m.t === 'snapshot' && m.frame > frameAtPause);

    // Disconnect again and stay away: A wins by forfeit when the grace period ends.
    const end = a.wait<Extract<ServerMessage, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd', 5000);
    await back.close();
    const e = await end;
    expect(e.reason).toBe('forfeit');
    expect(e.winner).toBe(0);
  });

  it('a player leaving mid-match forfeits immediately', async () => {
    const { a, b } = await startMatch();
    await a.wait<SnapMsg>((m) => m.t === 'snapshot' && m.state.phase === 'fight', 10000);
    const end = a.wait<Extract<ServerMessage, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd');
    b.send({ t: 'leaveRoom' });
    const e = await end;
    expect(e).toMatchObject({ winner: 0, reason: 'forfeit' });
  });
});

describe('13. message validation and abuse limits', () => {
  it('rejects malformed messages with errors', async () => {
    const c = await client('Mallory');
    const bad = ['not json', '{"t":"teleport"}', '{"t":"createRoom","extra":1}', '{"t":"input","seq":-1,"bits":0}', '{"t":"selectCharacter","char":"ryu"}', '[]'];
    for (const msg of bad) c.send(msg);
    await sleep(200);
    const errors = c.messages.filter((m) => m.t === 'error');
    expect(errors.length).toBe(bad.length);
    expect(errors.every((e) => e.t === 'error' && e.code === 'bad_message')).toBe(true);
    expect(c.closed).toBe(false);
  });

  it('requires hello before anything else and enforces the protocol version', async () => {
    const raw = await TestClient.open(server.port);
    clients.push(raw);
    raw.send({ t: 'createRoom' });
    const e = await raw.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error');
    expect(e.code).toBe('bad_message');
    raw.send({ t: 'hello', v: 999 });
    const v = await raw.wait<Extract<ServerMessage, { t: 'error' }>>((m) => m.t === 'error' && m !== e);
    expect(v.code).toBe('version_mismatch');
    await sleep(100);
    expect(raw.closed).toBe(true);
  });

  it('disconnects a client after repeated invalid messages', async () => {
    const c = await client('Spammer');
    for (let i = 0; i < 25; i++) c.send('garbage');
    await sleep(300);
    expect(c.closed).toBe(true);
    expect(c.closeCode).toBe(1008);
  });

  it('drops oversized frames', async () => {
    const c = await client('Big');
    c.send(JSON.stringify({ t: 'hello', v: 1, name: 'x'.repeat(5000) }));
    await sleep(200);
    // Either rejected as too large (error) or the socket is closed by maxPayload.
    expect(c.closed || c.messages.some((m) => m.t === 'error')).toBe(true);
  });

  it('rate-limits message floods', async () => {
    const c = await client('Flood');
    for (let i = 0; i < 400; i++) c.send({ t: 'ping', ts: i });
    await sleep(300);
    expect(c.messages.some((m) => m.t === 'error' && m.code === 'rate_limited')).toBe(true);
  });

  it('serves a minimal health check (no load figures, no CORS)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, protocol: 1 });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('limits room create/join attempts so codes cannot be brute-forced', async () => {
    const c = await client('Guesser');
    for (let i = 0; i < 12; i++) c.send({ t: 'joinRoom', code: 'QQQQ' + 'ABCDEFGHJKMN'[i] });
    await sleep(300);
    const errors = c.messages.filter((m) => m.t === 'error') as Extract<ServerMessage, { t: 'error' }>[];
    expect(errors.filter((e) => e.code === 'room_not_found').length).toBeLessThanOrEqual(6);
    expect(errors.some((e) => e.code === 'rate_limited')).toBe(true);
  });
});

describe('connection hardening (separate server instances)', () => {
  it('caps simultaneous connections per client IP', async () => {
    const srv = await createGameServer({ port: 0, host: '127.0.0.1', maxConnectionsPerIp: 3, log: () => undefined });
    const open: TestClient[] = [];
    try {
      for (let i = 0; i < 3; i++) open.push(await TestClient.connect(srv.port, `P${i}`));
      await expect(TestClient.open(srv.port)).rejects.toThrow(/429/);
      await open[0].close();
      await sleep(100);
      open.push(await TestClient.connect(srv.port, 'again')); // slot freed on close
    } finally {
      await Promise.all(open.map((c) => c.close()));
      await srv.close();
    }
  });

  /** Opens a raw WebSocket with custom headers; resolves 'open' or the HTTP error text. */
  const connectWith = async (port: number, headers: Record<string, string>) => {
    const WebSocket = (await import('ws')).default;
    return new Promise<{ result: string; close: () => void }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      ws.once('open', () => resolve({ result: 'open', close: () => ws.close() }));
      ws.once('error', (e) => resolve({ result: String(e.message), close: () => undefined }));
    });
  };

  it('documented Render setup (TRUST_PROXY=cloudflare): rotating X-Forwarded-For spoofs cannot bypass the per-IP cap', async () => {
    const srv = await createGameServer({ port: 0, host: '127.0.0.1', maxConnectionsPerIp: 3, clientIpPolicy: { mode: 'cloudflare' }, log: () => undefined });
    const open: { close: () => void }[] = [];
    try {
      // Same real client (CF-Connecting-IP) every time, a different forged left-most entry each
      // time, shaped like the header Render delivers (spoof, client, Cloudflare, internal).
      const render = (i: number) => ({ 'x-forwarded-for': `192.0.2.${i}, 81.107.0.110, 172.71.10.20, 10.214.3.4`, 'cf-connecting-ip': '81.107.0.110' });
      for (let i = 1; i <= 3; i++) {
        const c = await connectWith(srv.port, render(i));
        expect(c.result).toBe('open');
        open.push(c);
      }
      for (let i = 4; i <= 8; i++) expect((await connectWith(srv.port, render(i))).result).toMatch(/429/);
      // A genuinely different client still gets in.
      const other = await connectWith(srv.port, { 'cf-connecting-ip': '81.107.0.111', 'x-forwarded-for': '81.107.0.111' });
      expect(other.result).toBe('open');
      open.push(other);
    } finally {
      for (const c of open) c.close();
      await srv.close();
    }
  });

  it('generic proxy (TRUST_PROXY=xff + TRUSTED_PROXIES): prepended spoofs cannot bypass the per-IP cap', async () => {
    // The test connects from 127.0.0.1, standing in for the trusted reverse proxy.
    const srv = await createGameServer({
      port: 0,
      host: '127.0.0.1',
      maxConnectionsPerIp: 3,
      clientIpPolicy: parseClientIpPolicy('xff', '127.0.0.1'),
      log: () => undefined,
    });
    const open: { close: () => void }[] = [];
    try {
      const viaProxy = (spoof: string) => ({ 'x-forwarded-for': `${spoof}, 203.0.113.9` });
      for (let i = 1; i <= 3; i++) {
        const c = await connectWith(srv.port, viaProxy(`198.51.100.${i}`));
        expect(c.result).toBe('open');
        open.push(c);
      }
      for (const spoof of ['198.51.100.200', '127.0.0.1', '10.0.0.1, 8.8.8.8', 'junk']) {
        expect((await connectWith(srv.port, viaProxy(spoof))).result, spoof).toMatch(/429/);
      }
      const other = await connectWith(srv.port, { 'x-forwarded-for': '203.0.113.10' });
      expect(other.result).toBe('open');
      open.push(other);
    } finally {
      for (const c of open) c.close();
      await srv.close();
    }
  });

  it('default (TRUST_PROXY off): forwarding headers are ignored entirely', async () => {
    const srv = await createGameServer({ port: 0, host: '127.0.0.1', maxConnectionsPerIp: 2, log: () => undefined });
    const open: { result: string; close: () => void }[] = [];
    try {
      for (let i = 1; i <= 2; i++) open.push(await connectWith(srv.port, { 'x-forwarded-for': `192.0.2.${i}`, 'cf-connecting-ip': `192.0.2.${i}` }));
      expect(open.map((c) => c.result)).toEqual(['open', 'open']);
      expect((await connectWith(srv.port, { 'x-forwarded-for': '192.0.2.99', 'cf-connecting-ip': '192.0.2.99' })).result).toMatch(/429/);
    } finally {
      for (const c of open) c.close();
      await srv.close();
    }
  });

  it('accepts its own page origin and rejects others in "self" mode', async () => {
    const WebSocket = (await import('ws')).default;
    const srv = await createGameServer({ port: 0, host: '127.0.0.1', allowedOrigins: ['self'], log: () => undefined });
    const tryOrigin = (origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { origin } });
        ws.once('open', () => {
          ws.close();
          resolve('open');
        });
        ws.once('error', (e) => resolve(String(e.message)));
      });
    try {
      expect(await tryOrigin(`http://127.0.0.1:${srv.port}`)).toBe('open');
      expect(await tryOrigin('https://evil.example')).toMatch(/403/);
    } finally {
      await srv.close();
    }
  });
});
