// Removes files from the client build that the game never loads at runtime:
// the original (unprocessed) sprite sheets. They stay in the repository untouched.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'client', 'dist');
const target = path.join(dist, 'assets', 'characters', 'source');
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log('pruned client/dist/assets/characters/source (original sheets are not needed at runtime)');
}
