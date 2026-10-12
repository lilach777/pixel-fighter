import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../shared/src/protocol';
import { Player, type Transport } from '../../server/src/rooms/player';
import { RoomManager, generateRoomCode } from '../../server/src/rooms/roomManager';
import { isValidRoomCode } from '../../shared/src/protocol';

class FakeTransport implements Transport {
  sent: ServerMessage[] = [];
  open = true;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.open = false;
  }
  isOpen() {
    return this.open;
  }
}

function setup() {
  let t = 0;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const mgr = new RoomManager({
    snapshotEvery: 2,
    reconnectGraceMs: 5000,
    countdownMs: 1000,
    inputStaleMs: 600,
    speed: 1,
    postMatchFrames: 10,
    match: {},
    now: clock.now,
    log: () => undefined,
    maxRooms: 3,
    roomIdleMs: 60000,
  });
  const mk = (name: string) => {
    const p = new Player();
    p.name = name;
    const tr = new FakeTransport();
    p.transport = tr;
    return { p, tr };
  };
  return { mgr, clock, mk };
}

describe('room codes', () => {
  it('generates unambiguous 5-character codes', () => {
    const codes = new Set(Array.from({ length: 500 }, generateRoomCode));
    for (const c of codes) expect(isValidRoomCode(c)).toBe(true);
    expect(codes.size).toBeGreaterThan(490);
  });
});

describe('room manager', () => {
  it('creates rooms and enforces two-player capacity', () => {
    const { mgr, mk } = setup();
    const a = mk('A');
    const r = mgr.create(a.p);
    expect(r.ok).toBe(true);
    const code = r.ok ? r.room.code : '';
    expect(mgr.join(mk('B').p, code).ok).toBe(true);
    const c = mgr.join(mk('C').p, code);
    expect(c).toMatchObject({ ok: false, code: 'room_full' });
    expect(mgr.join(mk('D').p, 'QQQQQ')).toMatchObject({ ok: false, code: 'room_not_found' });
  });

  it('limits the number of rooms', () => {
    const { mgr, mk } = setup();
    for (let i = 0; i < 3; i++) expect(mgr.create(mk(`P${i}`).p).ok).toBe(true);
    expect(mgr.create(mk('X').p)).toMatchObject({ ok: false, code: 'server_full' });
  });

  it('deletes rooms when empty and cleans up idle lobbies', () => {
    const { mgr, mk, clock } = setup();
    const a = mk('A');
    const r = mgr.create(a.p);
    const code = r.ok ? r.room.code : '';
    mgr.leave(a.p);
    expect(mgr.rooms.has(code)).toBe(false);
    const b = mk('B');
    const r2 = mgr.create(b.p);
    clock.advance(61000);
    mgr.cleanup();
    expect(mgr.rooms.has(r2.ok ? r2.room.code : '')).toBe(false);
    expect(b.p.room).toBeNull();
  });
});

describe('room readiness and match lifecycle', () => {
  function twoPlayers() {
    const env = setup();
    const a = env.mk('A');
    const b = env.mk('B');
    const r = env.mgr.create(a.p);
    if (!r.ok) throw new Error('create failed');
    env.mgr.join(b.p, r.room.code);
    return { ...env, a, b, room: r.room };
  }

  it('needs a fighter before ready, and both ready to count down', () => {
    const { room, a, b, clock } = twoPlayers();
    expect(room.setReady(a.p, true)).toMatch(/fighter/i);
    room.selectCharacter(a.p, 'rick');
    room.selectCharacter(b.p, 'koala');
    expect(room.setReady(a.p, true)).toBeNull();
    expect(room.phase).toBe('lobby');
    room.setReady(b.p, true);
    expect(room.phase).toBe('countdown');
    // Un-readying during the countdown cancels it.
    room.setReady(b.p, false);
    expect(room.phase).toBe('lobby');
    room.setReady(b.p, true);
    clock.advance(1000);
    room.tick();
    expect(room.phase).toBe('playing');
    expect(a.tr.sent.some((m) => m.t === 'matchStart')).toBe(true);
    expect(room.selectCharacter(a.p, 'migo')).toMatch(/during a match/);
  });

  it('pauses on disconnect, resumes on reconnect, forfeits after grace', () => {
    const { room, a, b, clock } = twoPlayers();
    room.selectCharacter(a.p, 'rick');
    room.selectCharacter(b.p, 'koala');
    room.setReady(a.p, true);
    room.setReady(b.p, true);
    clock.advance(1000);
    room.tick();
    const frame = room.state!.frame;
    b.tr.open = false;
    b.p.transport = null;
    room.onDisconnect(b.p);
    expect(room.phase).toBe('paused');
    expect(a.tr.sent.some((m) => m.t === 'opponentStatus' && !m.connected)).toBe(true);
    room.tick();
    expect(room.state!.frame).toBe(frame);
    const tr2 = new FakeTransport();
    b.p.transport = tr2;
    room.onReconnect(b.p);
    expect(room.phase).toBe('playing');
    expect(tr2.sent.some((m) => m.t === 'matchStart')).toBe(true);
    // Drop again and let the grace period lapse.
    tr2.open = false;
    b.p.transport = null;
    room.onDisconnect(b.p);
    clock.advance(5001);
    room.tick();
    expect(room.phase).toBe('finished');
    const end = a.tr.sent.find((m) => m.t === 'matchEnd');
    expect(end).toMatchObject({ winner: 0, reason: 'forfeit' });
  });

  it('treats stale input as neutral and ignores replayed sequence numbers', () => {
    const { room, a, b, clock } = twoPlayers();
    room.selectCharacter(a.p, 'rick');
    room.selectCharacter(b.p, 'koala');
    room.setReady(a.p, true);
    room.setReady(b.p, true);
    clock.advance(1000);
    room.tick();
    room.setInput(a.p, 5, 8);
    room.setInput(a.p, 4, 0); // replay of an older seq: ignored
    expect(a.p.input).toBe(8);
    expect(a.p.lastSeq).toBe(5);
    // Skip the intro, then the held input moves the fighter only while fresh.
    for (let i = 0; i < 110; i++) {
      room.setInput(a.p, 6 + i, 8);
      clock.advance(16);
      room.tick();
    }
    const x = room.state!.fighters[0].x;
    clock.advance(1000); // input now stale
    for (let i = 0; i < 20; i++) room.tick();
    expect(room.state!.fighters[0].x).toBe(x);
  });

  it('requires both rematch votes', () => {
    const { room, a, b, clock } = twoPlayers();
    room.selectCharacter(a.p, 'rick');
    room.selectCharacter(b.p, 'koala');
    room.setReady(a.p, true);
    room.setReady(b.p, true);
    clock.advance(1000);
    room.tick();
    room.remove(b.p, 'leave');
    expect(room.phase).toBe('finished');
    expect(room.voteRematch(a.p, true)).toMatch(/opponent/i);
  });
});
