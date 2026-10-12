export interface FrameMeta {
  key: string;
  row: number;
  col: number;
  rect: { x: number; y: number; w: number; h: number };
  anchor: { x: number; y: number };
  bodyHeight: number;
}

export interface AnimMeta {
  frames: string[];
  ticks: number[];
  loop: boolean;
  phases?: ('startup' | 'active' | 'recovery')[];
  note?: string;
}

export interface CharacterSprites {
  id: string;
  image: HTMLImageElement;
  frames: Map<string, FrameMeta>;
  animations: Record<string, AnimMeta>;
  /** World-pixel scale so every character's idle stance has a consistent height. */
  scale: number;
}

const base = import.meta.env.BASE_URL;
export const assetUrl = (p: string) => `${base}assets/${p}`;
export const portraitUrl = (id: string) => assetUrl(`characters/processed/portraits/${id}.png`);
export const bustUrl = (id: string) => assetUrl(`characters/processed/portraits/${id}-bust.png`);

const cache = new Map<string, Promise<CharacterSprites>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** Loads (once) the atlas + metadata for a character. */
export function loadCharacterSprites(id: string, targetHeight: number): Promise<CharacterSprites> {
  const existing = cache.get(id);
  if (existing) return existing;
  const p = (async () => {
    const res = await fetch(assetUrl(`characters/metadata/${id}.json`));
    if (!res.ok) throw new Error(`Missing sprite metadata for ${id}`);
    const meta = (await res.json()) as { atlas: string; frames: FrameMeta[]; animations: Record<string, AnimMeta> };
    const image = await loadImage(assetUrl(`characters/${meta.atlas}`));
    const frames = new Map(meta.frames.map((f) => [f.key, f]));
    const idleKey = meta.animations.idle?.frames[0];
    const idleH = (idleKey && frames.get(idleKey)?.bodyHeight) || 150;
    return { id, image, frames, animations: meta.animations, scale: targetHeight / idleH };
  })();
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  return p;
}
