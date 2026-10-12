import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CHAR_DIR = path.join(ROOT, 'client', 'public', 'assets', 'characters');
export const SOURCE_DIR = path.join(CHAR_DIR, 'source');
export const PROCESSED_DIR = path.join(CHAR_DIR, 'processed');
export const METADATA_DIR = path.join(CHAR_DIR, 'metadata');

/** Character id -> matcher for the uploaded source filename. Filenames vary ("jeff garzik.png.png"). */
export const SHEET_MATCHERS: Record<string, RegExp> = {
  rick: /^rick\b/i,
  jeremy: /^jeremy\b/i,
  jcv: /^jcv\b/i,
  joshua: /^joshua\b/i,
  'max-sanchez': /^max[\s_-]*sanchez/i,
  koala: /^koala/i,
  migo: /^migo\b/i,
  'jeff-garzik': /^jeff[\s_-]*garzik/i,
};

export function findSourceSheets(): { id: string; file: string | null }[] {
  const files = fs.existsSync(SOURCE_DIR) ? fs.readdirSync(SOURCE_DIR) : [];
  return Object.entries(SHEET_MATCHERS).map(([id, re]) => {
    const file = files.find((f) => re.test(f) && /\.png$/i.test(f)) ?? null;
    return { id, file: file ? path.join(SOURCE_DIR, file) : null };
  });
}

export function readPng(file: string): PNG {
  return PNG.sync.read(fs.readFileSync(file));
}

export function writePng(file: string, png: PNG): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

export function px(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4;
  const d = png.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}
