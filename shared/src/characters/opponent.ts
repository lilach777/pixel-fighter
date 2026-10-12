import { CHARACTER_IDS, isCharacterId } from './roster';

/**
 * Single-player opponent selection: uniformly random from the roster excluding the
 * player's own fighter (never a mirror match). `random` is injectable for tests.
 */
export function pickOpponent(playerId: string, random: () => number = Math.random): string {
  if (!isCharacterId(playerId)) throw new Error(`Unknown player character: ${playerId}`);
  const pool = CHARACTER_IDS.filter((id) => id !== playerId);
  const i = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[i];
}
