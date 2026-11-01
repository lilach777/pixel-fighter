import { Btn, type ButtonName } from '../../../../shared/src/input';

/** KeyboardEvent.code values bound to each button (layout independent). */
export type Bindings = Record<ButtonName, string[]>;

export const P1_DEFAULT: Bindings = {
  UP: ['KeyW'],
  DOWN: ['KeyS'],
  LEFT: ['KeyA'],
  RIGHT: ['KeyD'],
  LP: ['KeyF'],
  HP: ['KeyG'],
  LK: ['KeyV'],
  HK: ['KeyB'],
  SP: ['KeyH'],
  SU: ['KeyJ'],
};

export const BUTTON_LABELS: Record<ButtonName, string> = {
  UP: 'Jump',
  DOWN: 'Crouch',
  LEFT: 'Left',
  RIGHT: 'Right',
  LP: 'Light Punch',
  HP: 'Heavy Punch',
  LK: 'Light Kick',
  HK: 'Heavy Kick',
  SP: 'Special',
  SU: 'Super',
};

export const BUTTON_ORDER: ButtonName[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'LP', 'HP', 'LK', 'HK', 'SP', 'SU'];

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Semicolon: ';',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    ShiftLeft: 'LShift',
    ShiftRight: 'RShift',
    Enter: 'Enter',
  };
  return map[code] ?? code;
}

/** Combines the bindings with the set of currently held key codes into an input mask. */
export function bitsFromKeys(b: Bindings, held: ReadonlySet<string>): number {
  let bits = 0;
  for (const name of BUTTON_ORDER) {
    if (b[name].some((code) => held.has(code))) bits |= Btn[name];
  }
  return bits;
}

export function allCodes(...bs: Bindings[]): Set<string> {
  const s = new Set<string>();
  for (const b of bs) for (const name of BUTTON_ORDER) for (const c of b[name]) s.add(c);
  return s;
}
