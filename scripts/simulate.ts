/**
 * Headless AI-vs-AI simulation for balance checks and engine smoke testing.
 * Usage: npx tsx scripts/simulate.ts [matchesPerPair=1] [difficulty=normal]
 */
import { AIController, type Difficulty } from '../shared/src/ai/ai';
import { CHARACTER_IDS } from '../shared/src/characters/roster';
import { createMatch } from '../shared/src/engine/state';
import { stepMatch } from '../shared/src/engine/sim';

const perPair = Number(process.argv[2] ?? 1);
const diff = (process.argv[3] ?? 'normal') as Difficulty;
const wins = new Map<string, number>(CHARACTER_IDS.map((id) => [id, 0]));
const games = new Map<string, number>(CHARACTER_IDS.map((id) => [id, 0]));
let totalFrames = 0;
let matches = 0;
const eventCounts = new Map<string, number>();
let seed = 1;
for (const a of CHARACTER_IDS) {
  for (const b of CHARACTER_IDS) {
    if (a === b) continue;
    for (let k = 0; k < perPair; k++) {
      const state = createMatch(a, b);
      const ais = [new AIController(0, diff, seed++), new AIController(1, diff, seed++)];
      let frames = 0;
      while (state.phase !== 'matchEnd' && frames < 60 * 60 * 6) {
        const ev = stepMatch(state, [ais[0].update(state), ais[1].update(state)]);
        for (const e of ev) eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
        frames++;
      }
      totalFrames += frames;
      matches++;
      games.set(a, games.get(a)! + 1);
      games.set(b, games.get(b)! + 1);
      if (state.matchWinner === 0) wins.set(a, wins.get(a)! + 1);
      if (state.matchWinner === 1) wins.set(b, wins.get(b)! + 1);
    }
  }
}
console.log(`matches=${matches} avgSeconds=${(totalFrames / matches / 60).toFixed(1)} difficulty=${diff}`);
for (const id of CHARACTER_IDS) console.log(id.padEnd(16), `win%=${((wins.get(id)! / games.get(id)!) * 100).toFixed(0)}`);
console.log(Object.fromEntries(eventCounts));
