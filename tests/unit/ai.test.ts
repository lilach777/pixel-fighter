import { describe, expect, it } from 'vitest';
import { AIController, AI_PROFILES } from '../../shared/src/ai/ai';
import { stepMatch } from '../../shared/src/engine/sim';
import { Btn } from '../../shared/src/input';
import { fightState } from './helpers';

describe('AI controller', () => {
  it('has three difficulty profiles with increasing skill', () => {
    const { easy, normal, hard } = AI_PROFILES;
    expect(easy.reactionFrames).toBeGreaterThan(normal.reactionFrames);
    expect(normal.reactionFrames).toBeGreaterThan(hard.reactionFrames);
    expect(easy.blockChance).toBeLessThan(hard.blockChance);
    expect(easy.mistakeRate).toBeGreaterThan(hard.mistakeRate);
    expect(easy.aggression).toBeLessThan(hard.aggression);
  });

  it('approaches a distant opponent instead of standing still', () => {
    const s = fightState('joshua', 'rick', [150, 800]);
    const ai = new AIController(1, 'normal', 7);
    for (let i = 0; i < 180; i++) stepMatch(s, [0, ai.update(s)]);
    expect(s.fighters[1].x).toBeLessThan(700);
  });

  it('never idles indefinitely against a passive opponent', () => {
    const s = fightState('joshua', 'rick', [300, 600]);
    const ai = new AIController(1, 'easy', 3);
    let lastChange = 0;
    let prevAction = s.fighters[1].action;
    let longestIdle = 0;
    for (let i = 0; i < 900; i++) {
      stepMatch(s, [0, ai.update(s)]);
      if (s.fighters[1].action !== prevAction) {
        prevAction = s.fighters[1].action;
        lastChange = i;
      }
      if (s.fighters[1].action === 'idle') longestIdle = Math.max(longestIdle, i - lastChange);
      if (s.phase !== 'fight') break;
    }
    expect(longestIdle).toBeLessThan(90);
  });

  it('attacks when in range and damages a passive opponent', () => {
    const s = fightState('joshua', 'rick', [400, 480]);
    const ai = new AIController(1, 'hard', 11);
    for (let i = 0; i < 600 && s.phase === 'fight'; i++) stepMatch(s, [0, ai.update(s)]);
    expect(s.fighters[0].health).toBeLessThan(s.fighters[0].maxHealth);
  });

  it('blocks repeated attacks more often on hard than on easy', () => {
    const blocks = (difficulty: 'easy' | 'hard') => {
      let count = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const s = fightState('joshua', 'jeremy', [400, 470]);
        const ai = new AIController(1, difficulty, seed);
        for (let i = 0; i < 600 && s.phase === 'fight'; i++) {
          // Scripted attacker: walk in and heavy punch every 40 frames.
          const p1 = i % 40 === 0 ? Btn.HP : Math.abs(s.fighters[0].x - s.fighters[1].x) > 90 ? Btn.RIGHT : 0;
          const ev = stepMatch(s, [p1, ai.update(s)]);
          count += ev.filter((e) => e.type === 'block' && e.attacker === 0).length;
          s.fighters[0].health = s.fighters[0].maxHealth;
          s.fighters[1].health = s.fighters[1].maxHealth;
        }
      }
      return count;
    };
    const hard = blocks('hard');
    const easy = blocks('easy');
    expect(hard).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(easy);
  });

  it('anti-airs or blocks jump-ins on hard', () => {
    const s = fightState('joshua', 'joshua', [300, 520]);
    const ai = new AIController(1, 'hard', 5);
    for (let i = 0; i < 900 && s.phase === 'fight'; i++) {
      const jump = i % 70 === 0 ? Btn.UP | Btn.RIGHT : 0;
      stepMatch(s, [jump, ai.update(s)]);
      s.fighters[0].health = s.fighters[0].maxHealth;
      s.fighters[1].health = s.fighters[1].maxHealth;
      if (s.fighters[0].x > s.fighters[1].x) {
        s.fighters[0].x = 300;
        s.fighters[1].x = 520;
      }
    }
    expect((ai.intents.antiAir ?? 0) + (ai.intents.block ?? 0)).toBeGreaterThan(0);
  });

  it('uses special moves and is deterministic for a given seed', () => {
    const play = () => {
      const s = fightState('joshua', 'jeremy', [200, 760]);
      const a = new AIController(0, 'normal', 99);
      const b = new AIController(1, 'normal', 100);
      let specials = 0;
      for (let i = 0; i < 1200 && s.phase === 'fight'; i++) {
        const ev = stepMatch(s, [a.update(s), b.update(s)]);
        specials += ev.filter((e) => e.type === 'special').length;
      }
      return { specials, hp: s.fighters.map((f) => f.health), x: s.fighters.map((f) => f.x) };
    };
    const r1 = play();
    const r2 = play();
    expect(r1.specials).toBeGreaterThan(0);
    expect(r1).toEqual(r2);
  });

  it('plays complete matches against itself on every difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = fightState('migo', 'koala', [300, 660]);
      const a = new AIController(0, d, 1);
      const b = new AIController(1, d, 2);
      let frames = 0;
      while (s.phase !== 'matchEnd' && frames < 60 * 60 * 8) {
        stepMatch(s, [a.update(s), b.update(s)]);
        frames++;
      }
      expect(s.phase, d).toBe('matchEnd');
      expect(s.matchWinner).not.toBeNull();
    }
  });
});
