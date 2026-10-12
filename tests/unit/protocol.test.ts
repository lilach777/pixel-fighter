import { describe, expect, it } from 'vitest';
import { createMatch } from '../../shared/src/engine/state';
import { MAX_MESSAGE_BYTES, normalizeRoomCode, parseClientMessage, sanitizeName, toNetState, validateClientMessage } from '../../shared/src/protocol';

describe('network message validation', () => {
  it('accepts every well-formed client message', () => {
    const good = [
      { t: 'hello', v: 1, name: 'Ann' },
      { t: 'createRoom' },
      { t: 'createRoom', name: 'Ann' },
      { t: 'joinRoom', code: 'abcde', name: 'Bo' },
      { t: 'joinRoom', code: 'abcde' },
      { t: 'selectCharacter', char: 'koala' },
      { t: 'ready', ready: true },
      { t: 'input', seq: 3, bits: 0b1111111111 },
      { t: 'rematch', vote: false },
      { t: 'leaveRoom' },
      { t: 'ping', ts: 12.5 },
    ];
    for (const m of good) expect(validateClientMessage(m).ok, JSON.stringify(m)).toBe(true);
  });

  it('normalizes room codes on join', () => {
    const r = validateClientMessage({ t: 'joinRoom', code: ' ab-cde ' });
    expect(r.ok && r.msg.t === 'joinRoom' && r.msg.code).toBe('ABCDE');
    expect(normalizeRoomCode('x y z')).toBe('XYZ');
  });

  it('rejects malformed messages', () => {
    const bad: unknown[] = [
      null,
      42,
      'hi',
      [],
      {},
      { t: 'nope' },
      { t: 'hello' },
      { t: 'hello', v: '1' },
      { t: 'createRoom', admin: true },
      { t: 'joinRoom', code: 7 },
      { t: 'joinRoom', code: 'X'.repeat(40) },
      { t: 'selectCharacter', char: 'goku' },
      { t: 'ready', ready: 'yes' },
      { t: 'input', seq: 1, bits: 1024 },
      { t: 'input', seq: 1.5, bits: 1 },
      { t: 'input', seq: 1, bits: -1 },
      { t: 'input', seq: 1, bits: 1, damage: 999 },
      { t: 'rematch' },
      { t: 'ping', ts: 'now' },
    ];
    for (const m of bad) expect(validateClientMessage(m).ok, JSON.stringify(m)).toBe(false);
  });

  it('rejects invalid JSON and oversized messages', () => {
    expect(parseClientMessage('{"t":').ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 1, name: 'x'.repeat(MAX_MESSAGE_BYTES) })).ok).toBe(false);
  });

  it('sanitizes display names', () => {
    expect(sanitizeName('<script>alert(1)</script>')).toBe('scriptalert1scri');
    expect(sanitizeName('   ')).toBe('Player');
    expect(sanitizeName(undefined)).toBe('Player');
  });

  it('strips private input state from snapshots', () => {
    const net = toNetState(createMatch('rick', 'migo'));
    expect('buffer' in net.fighters[0]).toBe(false);
    expect('lastInput' in net.fighters[0]).toBe(false);
    expect(net.fighters[1].health).toBeGreaterThan(0);
    expect(JSON.stringify(net).length).toBeLessThan(4000);
  });
});
