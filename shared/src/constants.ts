/** Simulation runs at a fixed 60 updates per second on both client and server. */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

/** Logical arena size in world pixels (the canvas renders at this resolution, scaled). */
export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 540;
export const GROUND_Y = 476;
export const STAGE_LEFT = 36;
export const STAGE_RIGHT = ARENA_WIDTH - 36;

export const GRAVITY = 0.92;
export const PUSHBOX_HALF_WIDTH = 34;
/** Fighters cannot walk further apart than this (keeps both on screen like a camera bound). */
export const MAX_SEPARATION = 760;

export const DEFAULT_ROUND_SECONDS = 60;
export const DEFAULT_ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 5;

export const INTRO_FRAMES = 100;
export const ROUND_END_FRAMES = 170;

export const METER_MAX = 100;
export const SUPER_COST = 100;

export const INPUT_BUFFER_FRAMES = 8;
export const DASH_TAP_WINDOW = 10;

/** Damage multiplier for the Nth hit of a combo (index 0 = first hit). */
export const COMBO_SCALING = [1, 1, 0.85, 0.72, 0.62, 0.52, 0.45, 0.4, 0.35, 0.3];
export const MIN_COMBO_SCALE = 0.3;
