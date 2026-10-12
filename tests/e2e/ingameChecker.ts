import type { Page } from '@playwright/test';

/**
 * Starts a local match with Max Sanchez, fills his meter (the only state injected), fires
 * the super and, on every rendered frame showing the flame-ring frame r3c5, counts
 * checker-grey pixels (neutral grey in the checkerboard's luma range) on the real game
 * canvas inside a box around Max. Returns the maximum seen and how many frames were sampled.
 */
export async function measureSuperChecker(page: Page, url = '/'): Promise<{ maxGrey: number; samples: number }> {
  await page.goto(url);
  await page.getByTestId('title-screen').click();
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-local').click();
  await page.getByTestId('char-max-sanchez').click();
  await page.getByTestId('char-joshua').click();
  await page.getByTestId('stage-rooftop').click();
  await page.getByTestId('versus-screen').click();
  await page.waitForSelector('[data-testid=hud][data-phase=fight]', { timeout: 15000 });
  await page.evaluate(() => {
    (window as any).__PF.getState().fighters[0].meter = 100;
  });
  const sampling = page.evaluate(async () => {
    const pf = (window as any).__PF;
    const canvas = document.querySelector('[data-testid=arena]') as HTMLCanvasElement;
    const g = canvas.getContext('2d')!;
    let maxGrey = 0;
    let samples = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const drawn = pf.runner.renderer?.lastFrames?.[0];
      if (!drawn || drawn.key !== 'r3c5') continue;
      const f = pf.getState().fighters[0];
      const x0 = Math.max(0, Math.round(f.x - 150));
      const y0 = Math.max(0, Math.round(f.y - 190));
      const w = Math.min(canvas.width - x0, 300);
      const h = Math.min(canvas.height - y0, 190);
      const d = g.getImageData(x0, y0, w, h).data;
      let grey = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const C = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (L >= 180 && L <= 236 && C <= 14) grey++;
      }
      samples++;
      maxGrey = Math.max(maxGrey, grey);
    }
    return { maxGrey, samples };
  });
  await page.keyboard.press('j', { delay: 40 });
  return sampling;
}
