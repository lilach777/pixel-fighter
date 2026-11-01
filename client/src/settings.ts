import { useSyncExternalStore } from 'react';
import type { Difficulty } from '../../shared/src/ai/ai';
import { P1_DEFAULT, type Bindings } from './game/input/bindings';

export interface Settings {
  volume: number;
  sfx: boolean;
  music: boolean;
  showHitboxes: boolean;
  crt: boolean;
  difficulty: Difficulty;
  roundSeconds: number;
  roundsToWin: number;
  p1: Bindings;
  playerName: string;
}

const KEY = 'pixel-fighters.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.6,
  sfx: true,
  music: true,
  showHitboxes: false,
  crt: true,
  difficulty: 'normal',
  roundSeconds: 60,
  roundsToWin: 2,
  p1: P1_DEFAULT,
  playerName: '',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Older saves may contain a "p2" key from the removed local-versus mode; it is dropped.
    const { p2: _legacyP2, ...rest } = parsed as Partial<Settings> & { p2?: unknown };
    void _legacyP2;
    return { ...DEFAULT_SETTINGS, ...rest, p1: { ...P1_DEFAULT, ...parsed.p1 } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const subs = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable (private mode): settings still apply for this session.
  }
  for (const s of subs) s();
}

export function resetSettings(): void {
  updateSettings(DEFAULT_SETTINGS);
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}
