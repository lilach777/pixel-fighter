import { expect, test } from '@playwright/test';

/** Captures reference screenshots into docs/screenshots (also a visual smoke test). */
test('capture screenshots of key screens', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${name}.png` });
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.waitForTimeout(400);
  await shot('01-title');
  await page.getByTestId('title-screen').click();
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-cpu').click();
  await page.getByTestId('char-koala').hover();
  await page.waitForTimeout(300);
  await shot('02-character-select');
  await page.getByTestId('char-koala').click();
  await expect(page.getByTestId('versus-screen')).toBeVisible();
  await page.waitForTimeout(300);
  await shot('02b-versus');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 10_000 });
  // Walk in and fight for a bit with real inputs.
  for (let i = 0; i < 14; i++) {
    const d = await page.evaluate(() => {
      const s = (window as any).__PF.getState();
      return Math.abs(s.fighters[1].x - s.fighters[0].x);
    });
    if (d > 100) {
      await page.keyboard.down('d');
      await page.waitForTimeout(150);
      await page.keyboard.up('d');
    } else {
      await page.keyboard.press(i % 2 ? 'g' : 'b', { delay: 40 });
      await page.waitForTimeout(160);
    }
  }
  await shot('03-match');
  // Give player 1 a full meter and fire the super to show the super banner.
  await page.evaluate(() => {
    (window as any).__PF.getState().fighters[0].meter = 100;
  });
  await page.keyboard.press('j', { delay: 40 });
  await page.waitForTimeout(250);
  await shot('04-super');
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-hitboxes').click();
  await page.getByTestId('pause-resume').click();
  await page.keyboard.press('h', { delay: 40 });
  await page.waitForTimeout(350);
  await shot('05-hitboxes');
});
