import { expect, test, type Page } from '@playwright/test';

/** Reads a numeric data attribute from the HUD. */
async function attr(page: Page, testId: string, name: string): Promise<number> {
  return Number(await page.getByTestId(testId).getAttribute(name));
}

async function toMainMenu(page: Page, query = '') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.getByTestId('title-screen').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
}

/** Single player; `idle` makes the CPU stand still (test builds only). */
async function startMatch(page: Page, p1: string, idle = false) {
  await toMainMenu(page, idle ? '?cpu=idle&stage=rooftop' : '');
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-cpu').click();
  await expect(page.getByTestId('character-select')).toBeVisible();
  await page.getByTestId(`char-${p1}`).click();
  // The CPU opponent is chosen automatically and shown on the VS screen first.
  await expect(page.getByTestId('versus-screen')).toBeVisible();
  await page.getByTestId('versus-screen').click();
  await expect(page.getByTestId('match-screen')).toBeVisible();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 10_000 });
}

/** Player 1 walks in and keeps punching until `done` resolves true (real key presses). */
async function attackUntil(page: Page, done: () => Promise<boolean>, maxMs = 90_000) {
  const t0 = Date.now();
  while (!(await done())) {
    if (Date.now() - t0 > maxMs) throw new Error('attackUntil timed out');
    const gap = await page.evaluate(() => {
      const s = (window as unknown as { __PF: { getState: () => { fighters: { x: number }[]; phase: string } } }).__PF.getState();
      return { d: Math.abs(s.fighters[1].x - s.fighters[0].x), phase: s.phase };
    });
    if (gap.phase !== 'fight') {
      await page.waitForTimeout(150);
      continue;
    }
    if (gap.d > 95) {
      await page.keyboard.down('d');
      await page.waitForTimeout(120);
      await page.keyboard.up('d');
    } else {
      await page.keyboard.press('g', { delay: 30 });
      await page.waitForTimeout(220);
    }
  }
}

test('main menu, how to play and options all work', async ({ page }) => {
  await toMainMenu(page);
  await expect(page.getByTestId('menu-play')).toBeVisible();
  await page.getByTestId('menu-howto').click();
  await expect(page.getByTestId('howto-screen')).toBeVisible();
  await expect(page.getByTestId('movelist-name')).toHaveText('RICK');
  await page.getByTestId('movelist-next').click();
  await expect(page.getByTestId('movelist-name')).toHaveText('JEREMY');
  await page.getByTestId('howto-back').click();
  await page.getByTestId('menu-options').click();
  await expect(page.getByTestId('options-screen')).toBeVisible();
  const hb = page.getByTestId('opt-showHitboxes');
  await expect(hb).toHaveText('OFF');
  await hb.click();
  await expect(hb).toHaveText('ON');
  await hb.click();
  await page.getByTestId('options-back').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  // Keyboard navigation and Escape back.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('play-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('main-menu')).toBeVisible();
});

test('character selection shows all eight fighters and starts a CPU match', async ({ page }) => {
  await toMainMenu(page);
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-cpu').click();
  for (const id of ['rick', 'jeremy', 'jcv', 'joshua', 'max-sanchez', 'koala', 'migo', 'jeff-garzik']) {
    await expect(page.getByTestId(`char-${id}`)).toBeVisible();
  }
  await expect(page.locator('.portrait-card')).toHaveCount(8);
  // Portraits actually load (real sprite art, not placeholders).
  const loaded = await page.$$eval('.portrait-card img', (imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 50));
  expect(loaded).toBe(true);
  await page.getByTestId('char-koala').hover();
  await expect(page.getByTestId('preview-left-name')).toHaveText('KOALA');
  await page.getByTestId('diff-hard').click();
  await page.getByTestId('char-koala').click();
  const opp = (await page.getByTestId('versus-screen').getAttribute('data-p2'))!;
  expect(opp).not.toBe('koala');
  await expect(page.getByTestId('match-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('p1-name')).toHaveText('KOALA');
  await expect(page.getByTestId('p2-name')).not.toHaveText('KOALA');
  await expect(page.getByTestId('timer')).toHaveAttribute('data-seconds', '60');
  await expect(page.getByTestId('round')).toHaveText('ROUND 1');
  // Sprites are loaded into the renderer.
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('canvas')].length))
    .toBe(1);
});

test('movement, attacks, health, timer and the pause menu (vs CPU)', async ({ page }) => {
  await startMatch(page, 'rick');
  const t0 = await attr(page, 'timer', 'data-seconds');
  const x0 = await page.evaluate(() => (window as any).__PF.getState().fighters[0].x);
  await page.keyboard.down('d');
  await page.waitForTimeout(500);
  await page.keyboard.up('d');
  const x1 = await page.evaluate(() => (window as any).__PF.getState().fighters[0].x);
  expect(x1).not.toBe(x0);
  await attackUntil(page, async () => (await attr(page, 'p2-health', 'data-health')) < (await attr(page, 'p2-health', 'data-max')), 30_000);
  await expect.poll(() => attr(page, 'timer', 'data-seconds')).toBeLessThan(t0);
  // Pause freezes the simulation.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const f1 = await page.evaluate(() => (window as any).__PF.getState().frame);
  await page.waitForTimeout(500);
  const f2 = await page.evaluate(() => (window as any).__PF.getState().frame);
  expect(f2).toBe(f1);
  await page.getByTestId('pause-resume').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__PF.getState().frame)).toBeGreaterThan(f2);
});

test('knockout, results screen and rematch (played out with real inputs)', async ({ page }) => {
  await startMatch(page, 'joshua', true);
  // The CPU stands still (test build); Player 1 wins two rounds by KO.
  await attackUntil(page, async () => (await attr(page, 'p1-wins', 'data-wins')) >= 1, 120_000);
  await expect(page.getByTestId('banner')).toBeVisible();
  await attackUntil(page, async () => (await page.getByTestId('results').count()) > 0, 120_000);
  await expect(page.getByTestId('result-title')).toHaveText('YOU WIN!');
  await expect(page.getByTestId('result-rounds')).toHaveText('2 - 0');
  await page.getByTestId('result-rematch').click();
  await expect(page.getByTestId('results')).toBeHidden();
  await expect(page.getByTestId('round')).toHaveText('ROUND 1');
  await expect(page.getByTestId('p1-wins')).toHaveAttribute('data-wins', '0');
  await expect(page.getByTestId('timer')).toHaveAttribute('data-seconds', '60');
});
