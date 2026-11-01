import { expect, test } from '@playwright/test';

const demo = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__PFDemo);
const ROSTER = ['rick', 'jeremy', 'jcv', 'joshua', 'max-sanchez', 'koala', 'migo', 'jeff-garzik'];

test('title screen: two real roster fighters fight behind a readable logo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByTestId('title-scene')).toBeVisible();
  await expect.poll(async () => (await demo(page))?.pair, { timeout: 10_000 }).toBeTruthy();
  const d0 = await demo(page);
  expect(d0.running).toBe(true);
  expect(d0.pair[0]).not.toBe(d0.pair[1]);
  for (const c of d0.pair) expect(ROSTER).toContain(c);
  // Real exchanges happen: hits and blocks from the engine.
  await expect.poll(async () => (await demo(page)).hits, { timeout: 20_000 }).toBeGreaterThan(2);
  await expect.poll(async () => (await demo(page)).blocks + (await demo(page)).specials, { timeout: 30_000 }).toBeGreaterThan(0);
  // The canvas really changes over time (animated, not a still image).
  const snap = () => page.locator('[data-testid=title-scene] canvas').screenshot();
  const a = await snap();
  await page.waitForTimeout(400);
  const b = await snap();
  expect(a.equals(b)).toBe(false);
  // Logo and prompt stay visible above the scene.
  await expect(page.locator('.logo')).toBeVisible();
  await expect(page.getByTestId('press-start')).toBeVisible();
  const logoBox = (await page.locator('.logo').boundingBox())!;
  const screenBox = (await page.getByTestId('screen').boundingBox())!;
  expect(logoBox.y + logoBox.height).toBeLessThan(screenBox.y + screenBox.height * 0.5); // fighters occupy the lower half
  expect(errors).toEqual([]);
});

test('menu input stays responsive while the fight runs; one loop; stops in a match', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await demo(page))?.pair, { timeout: 10_000 }).toBeTruthy();
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('play-menu')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2000);
  // Same single demo instance carried through title -> menu -> mode select.
  const d = await demo(page);
  expect(d.running).toBe(true);
  expect(d.pairsShown).toBe(1);
  // Leaving the menus (character select, then a match) stops the demo loop.
  await page.getByTestId('mode-cpu').click();
  await expect(page.getByTestId('title-scene')).toHaveCount(0);
  expect((await demo(page)).running).toBe(false);
});

test('title layout adapts to small and large windows', async ({ page }) => {
  await page.goto('/');
  for (const [w, h] of [
    [640, 400],
    [1600, 900],
    [900, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const screen = (await page.getByTestId('screen').boundingBox())!;
    const btn = (await page.getByTestId('press-start').boundingBox())!;
    const canvas = (await page.locator('[data-testid=title-scene] canvas').boundingBox())!;
    expect(btn.y + btn.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
    expect(Math.abs(canvas.width - screen.width)).toBeLessThan(2);
    expect(Math.abs(canvas.height - screen.height)).toBeLessThan(2);
  }
  await page.getByTestId('press-start').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
});

test('in-match movement renders smoothly on every displayed frame', async ({ page }) => {
  await page.goto('/?cpu=idle&stage=rooftop');
  await page.getByTestId('title-screen').click();
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-cpu').click();
  await page.getByTestId('char-jcv').click();
  await page.getByTestId('versus-screen').click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 10_000 });
  // Measure rendering, not asset loading: the CPU opponent is random, so its atlas may still be
  // downloading/decoding (a one-off main-thread stall). Start once both fighters' sprites are in.
  await expect.poll(() => page.evaluate(() => !!(window as any).__PF.runner.renderer?.spritesLoaded), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(300);
  const rec = page.evaluate(async () => {
    const pf = (window as any).__PF;
    const xs: number[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1100) {
      await new Promise((r) => requestAnimationFrame(r));
      xs.push(pf.runner.renderer.lastFrames[0].x);
    }
    return xs;
  });
  await page.keyboard.down('d');
  const xs = (await rec).slice(12, -4);
  await page.keyboard.up('d');
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  expect(mean).toBeGreaterThan(0.5);
  // No stalled or doubled frames while walking (raw 60 Hz positions stall on fast displays).
  expect(steps.filter((s) => Math.abs(s) < 0.01).length).toBe(0);
  expect(steps.filter((s) => s > mean * 1.8).length).toBeLessThanOrEqual(1);
});
