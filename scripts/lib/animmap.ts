/**
 * Animation mapping: a shared template (all roster sheets follow the same six-row layout)
 * plus per-character overrides, because frame counts per row differ between sheets.
 * Every referenced frame key is validated against the frames actually sliced from the
 * sheet — a missing frame is reported, never invented.
 */
export interface AnimSpec {
  /** Frame keys like "r2c0". */
  frames: string[];
  /** Ticks (1/60 s) each frame is shown; one value applies to all frames. */
  ticks: number | number[];
  loop?: boolean;
  /** For attacks: the move phase each frame belongs to. */
  phases?: ('startup' | 'active' | 'recovery')[];
  /** Free-text note shown in docs, e.g. when an animation is derived from other frames. */
  note?: string;
}

export interface AnimationMapFile {
  template: Record<string, AnimSpec>;
  characters: Record<string, { overrides?: Record<string, AnimSpec>; notes?: string[] }>;
}

export interface ResolvedAnim {
  frames: string[];
  ticks: number[];
  loop: boolean;
  phases?: ('startup' | 'active' | 'recovery')[];
  note?: string;
}

export function resolveAnimations(
  map: AnimationMapFile,
  id: string,
  available: Set<string>,
): { animations: Record<string, ResolvedAnim>; issues: string[] } {
  const issues: string[] = [];
  const merged: Record<string, AnimSpec> = { ...map.template, ...(map.characters[id]?.overrides ?? {}) };
  const animations: Record<string, ResolvedAnim> = {};
  for (const [name, spec] of Object.entries(merged)) {
    const missing = spec.frames.filter((k) => !available.has(k));
    if (missing.length) issues.push(`${id}.${name}: frames not found on sheet: ${missing.join(', ')}`);
    const ticks = Array.isArray(spec.ticks) ? spec.ticks : spec.frames.map(() => spec.ticks as number);
    if (ticks.length !== spec.frames.length) issues.push(`${id}.${name}: ticks length ${ticks.length} != frames ${spec.frames.length}`);
    if (spec.phases && spec.phases.length !== spec.frames.length) issues.push(`${id}.${name}: phases length mismatch`);
    animations[name] = { frames: spec.frames, ticks, loop: spec.loop ?? false, phases: spec.phases, note: spec.note };
  }
  return { animations, issues };
}
