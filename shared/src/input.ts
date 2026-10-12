/**
 * Player input is a 10-bit mask, identical for keyboard, AI and network input.
 * Directions are absolute (screen left/right); the engine converts to forward/back.
 */
export const Btn = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  LP: 1 << 4,
  HP: 1 << 5,
  LK: 1 << 6,
  HK: 1 << 7,
  SP: 1 << 8,
  SU: 1 << 9,
} as const;

export type ButtonName = keyof typeof Btn;
export const BUTTON_NAMES = Object.keys(Btn) as ButtonName[];
export const INPUT_MASK = (1 << 10) - 1;
export const ATTACK_BUTTONS = Btn.LP | Btn.HP | Btn.LK | Btn.HK | Btn.SP | Btn.SU;
export const DIRECTION_BUTTONS = Btn.UP | Btn.DOWN | Btn.LEFT | Btn.RIGHT;

export function has(bits: number, b: number): boolean {
  return (bits & b) !== 0;
}

/** Removes impossible combinations (left+right, up+down) so every source behaves the same. */
export function sanitizeInput(bits: number): number {
  let b = bits & INPUT_MASK;
  if (has(b, Btn.LEFT) && has(b, Btn.RIGHT)) b &= ~(Btn.LEFT | Btn.RIGHT);
  if (has(b, Btn.UP) && has(b, Btn.DOWN)) b &= ~(Btn.UP | Btn.DOWN);
  return b;
}

export function describeInput(bits: number): string {
  return BUTTON_NAMES.filter((n) => has(bits, Btn[n])).join('+') || 'neutral';
}
