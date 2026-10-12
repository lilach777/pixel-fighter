import { describe, expect, it } from 'vitest';
import { pickOpponent } from '../../shared/src/characters/opponent';
import { CHARACTER_IDS } from '../../shared/src/characters/roster';
import { Rng } from '../../shared/src/rng';

describe('automatic opponent selection', () => {
  it('never picks the player character', () => {
    const rng = new Rng(5);
    for (const me of CHARACTER_IDS) for (let i = 0; i < 200; i++) expect(pickOpponent(me, () => rng.next())).not.toBe(me);
  });

  it('can pick every one of the other seven fighters, and nothing else', () => {
    expect(CHARACTER_IDS).toHaveLength(8);
    for (const me of CHARACTER_IDS) {
      const seen = new Set<string>();
      for (let k = 0; k < 7; k++) seen.add(pickOpponent(me, () => (k + 0.5) / 7));
      expect(seen.size).toBe(7);
      for (const id of seen) expect(CHARACTER_IDS).toContain(id);
      expect(seen.has(me)).toBe(false);
    }
  });

  it('handles edge random values and rejects unknown players', () => {
    expect(CHARACTER_IDS).toContain(pickOpponent('rick', () => 0));
    expect(CHARACTER_IDS).toContain(pickOpponent('rick', () => 0.9999999));
    expect(() => pickOpponent('nobody')).toThrow();
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) expect(pickOpponent('rick', () => rng.next())).not.toBe('rick');
  });
});
