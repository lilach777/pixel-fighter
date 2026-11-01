import { expect, test, type Page } from '@playwright/test';
import { getCharacter } from '../../shared/src/characters/roster';

/**
 * Player controls, automatic opponent selection and match initialisation, verified in a
 * real browser with real key presses. Runs against both the production build and the
 * dev server (React StrictMode).
 */

interface Sample {
  frame: number;
  action: string;
  move: string | null;
  af: number;
  airborne: boolean;
  attackId: number;
  x: number;
  hp2: number;
  action2: string;
  x2: number;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__PF.getState();
    const [f, g] = s.fighters;
    return { phase: s.phase, x: f.x, action: f.action, move: f.move, attackId: f.attackId, hp2: g.health, x2: g.x, action2: g.action, round: s.round, timer: s.timer, wins: s.wins, hp1: f.health, meter: f.meter };
  });

/** Samples the match state every ~4 ms in the page for `ms` milliseconds. */
function record(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(async (ms) => {
    const out: Sample[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const s = (window as any).__PF.getState();
      const [f, g] = s.fighters;
      if (!out.length || out[out.length - 1].frame !== s.frame)
        out.push({ frame: s.frame, action: f.action, move: f.move, af: f.actionFrame, airborne: f.airborne, attackId: f.attackId, x: f.x, hp2: g.health, action2: g.action, x2: g.x });
      await new Promise((r) => setTimeout(r, 4));
    }
    return out;
  }, ms);
}

async function toPlayMenu(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByTestId('title-screen').click();
  await page.getByTestId('menu-play').click();
}

/** Single player: pick only our fighter; the opponent is chosen automatically. */
async function startCpu(page: Page, me: string, query = ''): Promise<string> {
  await toPlayMenu(page, query);
  await page.getByTestId('mode-cpu').click();
  await page.getByTestId(`char-${me}`).click();
  const vs = page.getByTestId('versus-screen');
  await expect(vs).toBeVisible();
  const opp = (await vs.getAttribute('data-p2'))!;
  await expect(page.getByTestId('match-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 10_000 });
  return opp;
}

/**
 * Single player against a CPU that stands still (test builds only: ?cpu=idle), on a fixed
 * stage. A deterministic target for the exact control and damage checks.
 */
async function startIdleCpu(page: Page, me: string) {
  await toPlayMenu(page, '?cpu=idle&stage=rooftop');
  await page.getByTestId('mode-cpu').click();
  await page.getByTestId(`char-${me}`).click();
  await page.getByTestId('versus-screen').click(); // skip the countdown
  await expect(page.getByTestId('match-screen')).toHaveAttribute('data-controllers', 'keyboard-p1,idle');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 10_000 });
}

async function walkInto(page: Page, gap = 90) {
  for (let i = 0; i < 40; i++) {
    const s = await state(page);
    if (Math.abs(s.x2 - s.x) <= gap) return;
    await page.keyboard.down('d');
    await page.waitForTimeout(80);
    await page.keyboard.up('d');
  }
  throw new Error('could not close distance');
}

test('1-3. selecting a fighter auto-assigns a different opponent, shown before the fight', async ({ page }) => {
  const seen = new Set<string>();
  for (const me of ['rick', 'koala', 'migo']) {
    await toPlayMenu(page);
    await page.getByTestId('mode-cpu').click();
    await expect(page.getByTestId('cpu-pending')).toContainText(/automatically/i);
    await page.getByTestId(`char-${me}`).click();
    const vs = page.getByTestId('versus-screen');
    await expect(vs).toBeVisible();
    const opp = (await vs.getAttribute('data-p2'))!;
    expect(opp).not.toBe(me);
    seen.add(opp);
    await expect(page.getByTestId('vs-p2-name')).toHaveText(getCharacter(opp).name.toUpperCase());
    await expect(page.getByTestId('vs-countdown')).toContainText(/FIGHT/);
    // Match initialises with exactly these two fighters, AI on slot 2.
    const match = page.getByTestId('match-screen');
    await expect(match).toBeVisible({ timeout: 10_000 });
    await expect(match).toHaveAttribute('data-p1', me);
    await expect(match).toHaveAttribute('data-p2', opp);
    await expect(match).toHaveAttribute('data-controllers', 'keyboard-p1,ai');
    const s = await state(page);
    expect(s.hp1).toBeGreaterThan(0);
    expect(s.round).toBe(1);
    expect(s.wins).toEqual([0, 0]);
    expect(s.meter).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-main').click();
  }
  expect(seen.size).toBeGreaterThanOrEqual(1);
});

test('4-5. player moves left/right immediately, jumps and crouches', async ({ page }) => {
  await startIdleCpu(page, 'rick');
  const s0 = await state(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  const s1 = await state(page);
  expect(s1.x).toBeGreaterThan(s0.x + 30);
  await page.keyboard.down('a');
  await page.waitForTimeout(400);
  await page.keyboard.up('a');
  const s2 = await state(page);
  expect(s2.x).toBeLessThan(s1.x - 20);

  const jumpRec = record(page, 900);
  await page.keyboard.press('w', { delay: 40 });
  const jr = await jumpRec;
  expect(jr.some((r) => r.airborne)).toBe(true);
  expect(jr[jr.length - 1].airborne).toBe(false); // landed again

  await page.keyboard.down('s');
  await page.waitForTimeout(150);
  expect((await state(page)).action).toBe('crouch');
  await page.keyboard.up('s');
  await page.waitForTimeout(100);
  expect((await state(page)).action).toBe('idle');
});

test('6-8. F, G, V and B start the right attacks, run startup/active/recovery and return to neutral', async ({ page }) => {
  await startIdleCpu(page, 'joshua');
  const moves = getCharacter('joshua').moves;
  for (const [key, slot] of [
    ['f', 'lp'],
    ['g', 'hp'],
    ['v', 'lk'],
    ['b', 'hk'],
  ] as const) {
    const m = moves[slot];
    const total = m.startup + m.active + m.recovery;
    const rec = record(page, ((total + 12) / 60) * 1000 + 200);
    await page.keyboard.press(key, { delay: 30 });
    const r = await rec;
    const during = r.filter((x) => x.action === 'attack' && x.move === slot);
    expect(during.length, `${key} -> ${slot}`).toBeGreaterThan(0);
    // Frames observed in each phase.
    expect(during.some((x) => x.af < m.startup)).toBe(true);
    expect(during.some((x) => x.af >= m.startup && x.af < m.startup + m.active)).toBe(true);
    expect(during.some((x) => x.af >= m.startup + m.active)).toBe(true);
    // Back to neutral (not stuck).
    expect(r[r.length - 1].action).toBe('idle');
  }
});

test('9-11. valid hits damage the opponent, cause hit-stun and knockback; attacking again works', async ({ page }) => {
  await startIdleCpu(page, 'joshua');
  await walkInto(page);
  const before = await state(page);
  const rec = record(page, 700);
  await page.keyboard.press('g', { delay: 30 });
  const r = await rec;
  const after = await state(page);
  expect(after.hp2).toBe(before.hp2 - getCharacter('joshua').moves.hp.damage);
  expect(r.some((x) => x.action2 === 'hitstun')).toBe(true);
  expect(after.x2).toBeGreaterThan(before.x2); // pushed back
  // Attack again after recovery.
  const id = after.attackId;
  await walkInto(page);
  await page.keyboard.press('f', { delay: 30 });
  await page.waitForTimeout(300);
  const again = await state(page);
  expect(again.attackId).toBe(id + 1);
  expect(again.hp2).toBeLessThan(after.hp2);
  // Out-of-range attacks whiff (no fake damage on key press).
  await page.keyboard.down('a');
  await page.waitForTimeout(700);
  await page.keyboard.up('a');
  const far = await state(page);
  await page.keyboard.press('g', { delay: 30 });
  await page.waitForTimeout(500);
  expect((await state(page)).hp2).toBe(far.hp2);
});

test('player can block a real CPU attack by holding back', async ({ page }) => {
  await startCpu(page, 'jeremy');
  // Hold away from the CPU (Player 1 starts on the left) and wait for the AI to attack.
  await page.keyboard.down('a');
  const sawBlock = await page.evaluate(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 20_000) {
      if ((window as any).__PF.getState().fighters[0].action === 'blockstun') return true;
      await new Promise((r) => setTimeout(r, 4));
    }
    return false;
  });
  await page.keyboard.up('a');
  expect(sawBlock).toBe(true);
});

test('12. the single-player opponent is driven by the AI (moves and attacks on its own)', async ({ page }) => {
  await startCpu(page, 'rick');
  const s0 = await state(page);
  // No input from us at all.
  await expect.poll(async () => {
    const s = await state(page);
    return Math.abs(s.x2 - s0.x2) > 30 || s.hp1 < s0.hp1;
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await state(page)).hp1, { timeout: 20_000 }).toBeLessThan(s0.hp1);
});

test('15. restart/rematch keeps the opponent and resets the match', async ({ page }) => {
  const opp = await startCpu(page, 'koala');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-restart').click();
  const match = page.getByTestId('match-screen');
  await expect(match).toHaveAttribute('data-p2', opp);
  const s = await state(page);
  expect(s.phase).toBe('intro');
  expect(s.round).toBe(1);
  expect(s.hp1).toBe(getCharacter('koala').stats.maxHealth);
  expect(s.hp2).toBe(getCharacter(opp).stats.maxHealth);
  expect(Math.ceil(s.timer / 60)).toBe(60);
});

test('debug panel: dev only, reports mode, fighters, controllers, state and input', async ({ page }, info) => {
  await startCpu(page, 'jcv', '?debug=1');
  const panel = page.getByTestId('debug-panel');
  if (info.project.name === 'prod') {
    await expect(panel).toHaveCount(0);
    return;
  }
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-debug="mode"]')).toContainText('cpu');
  await expect(panel.locator('[data-debug="player"]')).toContainText('JCV');
  await expect(panel.locator('[data-debug="controllers"]')).toContainText('keyboard-p1 / ai');
  await expect(panel.locator('[data-debug="loop"]')).toContainText('running');
  await page.keyboard.down('d');
  await expect(panel.locator('[data-debug="last input P1"]')).toContainText('RIGHT');
  await page.keyboard.up('d');
  await expect(panel.locator('[data-debug="animation"]')).not.toContainText('loading');
});
