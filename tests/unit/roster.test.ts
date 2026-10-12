import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, ROSTER, getCharacter, isCharacterId } from '../../shared/src/characters/roster';
import type { MoveSlot } from '../../shared/src/characters/types';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHAR_DIR = path.join(ROOT, 'client', 'public', 'assets', 'characters');

interface Meta {
  id: string;
  atlas: string;
  atlasSize: { w: number; h: number };
  frames: { key: string; rect: { x: number; y: number; w: number; h: number }; anchor: { x: number; y: number } }[];
  animations: Record<string, { frames: string[]; ticks: number[]; loop: boolean; phases?: string[] }>;
}
const meta = (id: string): Meta => JSON.parse(fs.readFileSync(path.join(CHAR_DIR, 'metadata', `${id}.json`), 'utf8'));

describe('character registry', () => {
  it('contains exactly the eight roster characters', () => {
    expect(ROSTER.map((c) => c.name)).toEqual([
      'Rick',
      'Jeremy',
      'JCV',
      'Joshua',
      'Max Sanchez',
      'Koala',
      'Migo',
      'Jeff Garzik',
    ]);
    expect(new Set(CHARACTER_IDS).size).toBe(8);
  });

  it('ships character assets only for roster characters', () => {
    const ids = new Set(CHARACTER_IDS);
    const meta = fs.readdirSync(path.join(CHAR_DIR, 'metadata')).filter((f) => f !== 'index.json');
    expect(meta.map((f) => f.replace(/.json$/, '')).sort()).toEqual([...ids].sort());
    const atlases = fs.readdirSync(path.join(CHAR_DIR, 'processed')).filter((f) => f.endsWith('.png'));
    expect(atlases.map((f) => f.replace(/.png$/, '')).sort()).toEqual([...ids].sort());
    for (const f of fs.readdirSync(path.join(CHAR_DIR, 'processed', 'portraits'))) expect(ids.has(f.replace(/(-bust)?.png$/, '')), f).toBe(true);
    expect(fs.readdirSync(path.join(CHAR_DIR, 'source'))).toHaveLength(ids.size);
    const index = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, 'metadata', 'index.json'), 'utf8')) as { id: string }[];
    expect(index.map((x) => x.id).sort()).toEqual([...ids].sort());
  });

  it('looks characters up by id and rejects unknown ids', () => {
    expect(getCharacter('koala').name).toBe('Koala');
    expect(isCharacterId('migo')).toBe(true);
    expect(isCharacterId('ryu')).toBe(false);
    expect(isCharacterId(42)).toBe(false);
    expect(() => getCharacter('nobody')).toThrow();
  });

  it('gives every fighter a special, an alternate special and a super with sane frame data', () => {
    const slots: MoveSlot[] = ['lp', 'hp', 'lk', 'hk', 'crLk', 'launcher', 'airPunch', 'airKick', 'special', 'specialAlt', 'super'];
    for (const c of ROSTER) {
      for (const slot of slots) {
        const m = c.moves[slot];
        expect(m, `${c.id}.${slot}`).toBeDefined();
        expect(m.startup).toBeGreaterThan(0);
        expect(m.active).toBeGreaterThan(0);
        expect(m.recovery).toBeGreaterThan(0);
        expect(m.damage + (m.projectile?.damage ?? 0)).toBeGreaterThan(0);
        if (m.projectile) expect(m.projectile.spawnFrame).toBeLessThan(m.startup + m.active + m.recovery);
      }
      expect(c.moves.super.meterCost).toBe(100);
      expect(c.superName.length).toBeGreaterThan(0);
    }
  });

  it('has distinct movesets (special names differ between characters)', () => {
    const names = ROSTER.map((c) => c.moves.special.name);
    expect(new Set(names).size).toBe(ROSTER.length);
  });
});

describe('sprite metadata', () => {
  it.each(CHARACTER_IDS)('%s: atlas exists and matches metadata dimensions', (id) => {
    const m = meta(id);
    const png = PNG.sync.read(fs.readFileSync(path.join(CHAR_DIR, m.atlas)));
    expect(png.width).toBe(m.atlasSize.w);
    expect(png.height).toBe(m.atlasSize.h);
    for (const f of m.frames) {
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(m.atlasSize.w);
      expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(m.atlasSize.h);
      expect(f.anchor.x).toBeGreaterThanOrEqual(0);
      expect(f.anchor.y).toBeLessThanOrEqual(f.rect.h);
    }
  });

  it.each(CHARACTER_IDS)('%s: every animation used by the moveset exists with valid frames and timing', (id) => {
    const m = meta(id);
    const keys = new Set(m.frames.map((f) => f.key));
    const c = getCharacter(id);
    const required = ['idle', 'walk', 'walkBack', 'run', 'crouch', 'jump', 'block', 'crouchBlock', 'hurt', 'knockdown', 'getup', 'victory', 'timeoutLoss', 'portrait', 'intro'];
    for (const a of [...required, ...Object.values(c.moves).map((mv) => mv.anim)]) {
      const anim = m.animations[a];
      expect(anim, `${id}.${a}`).toBeDefined();
      expect(anim.frames.length).toBeGreaterThan(0);
      expect(anim.ticks).toHaveLength(anim.frames.length);
      for (const t of anim.ticks) expect(t).toBeGreaterThan(0);
      for (const k of anim.frames) expect(keys.has(k), `${id}.${a} frame ${k}`).toBe(true);
      if (anim.phases) expect(anim.phases).toHaveLength(anim.frames.length);
    }
  });

  it.each(CHARACTER_IDS)('%s: processed atlas has real transparency (checkerboard removed)', (id) => {
    const m = meta(id);
    const png = PNG.sync.read(fs.readFileSync(path.join(CHAR_DIR, m.atlas)));
    let transparent = 0;
    let opaque = 0;
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i] === 0) transparent++;
      else if (png.data[i] === 255) opaque++;
    }
    const total = png.width * png.height;
    expect(transparent / total).toBeGreaterThan(0.3);
    expect(opaque / total).toBeGreaterThan(0.1);
  });
});
