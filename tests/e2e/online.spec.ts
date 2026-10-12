import { expect, test, type Page } from '@playwright/test';

/**
 * Two separate browser contexts (separate storage, separate WebSocket connections)
 * play an online match through the real server.
 */
async function openLobby(page: Page, name: string) {
  await page.goto('/?screen=online');
  await expect(page.getByTestId('online-lobby')).toBeVisible();
  await page.getByTestId('name-input').fill(name);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');
}

const health = async (page: Page, side: 'p1' | 'p2') => Number(await page.getByTestId(`${side}-health`).getAttribute('data-health'));

test('online: create, join, ready up and fight a synchronized match', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await openLobby(a, 'Alpha');
  await a.getByTestId('create-room').click();
  await expect(a.getByTestId('room-screen')).toBeVisible();
  const code = (await a.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await expect(a.getByTestId('waiting-opponent')).toBeVisible();

  // Invalid code is rejected with a message.
  await openLobby(b, 'Bravo');
  await b.getByTestId('join-room').click();
  await b.getByTestId('code-input').fill('ZZZZ9');
  await b.getByTestId('join-submit').click();
  await expect(b.getByTestId('online-error')).toContainText('does not exist');

  // Valid code joins.
  await b.getByTestId('code-input').fill(code.toLowerCase());
  await b.getByTestId('join-submit').click();
  await expect(b.getByTestId('room-screen')).toBeVisible();
  await expect(b.getByTestId('room-code')).toHaveText(code);
  await expect(a.getByTestId('slot-opponent')).toContainText('Bravo');

  // Exactly the eight roster fighters are offered online.
  await expect(a.locator('[data-testid^="online-char-"]')).toHaveCount(8);
  // Both pick fighters; match only starts once both are ready.
  await a.getByTestId('online-char-rick').click();
  await b.getByTestId('online-char-migo').click();
  await a.getByTestId('ready-toggle').click();
  await expect(b.getByTestId('opponent-ready')).toHaveText('READY');
  await expect(a.getByTestId('room-screen')).toHaveAttribute('data-phase', 'lobby');
  await b.getByTestId('ready-toggle').click();
  await expect(a.getByTestId('online-match')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('online-match')).toBeVisible();
  await expect(a.getByTestId('online-match')).toHaveAttribute('data-you', '0');
  await expect(b.getByTestId('online-match')).toHaveAttribute('data-you', '1');
  await expect(a.getByTestId('p1-name')).toHaveText('ALPHA');
  await expect(b.getByTestId('p2-name')).toHaveText('BRAVO');
  await expect(a.getByTestId('hud')).toHaveAttribute('data-phase', 'fight', { timeout: 15_000 });
  // The opponent is the remote human: no local AI or local match runner exists online.
  expect(await a.evaluate(() => (window as any).__PF.mode)).toBe('online');
  expect(await b.evaluate(() => (window as any).__PF.mode)).toBe('online');
  expect(await a.evaluate(() => 'ai' in (window as any).__PF.runner)).toBe(false);

  // Player A walks in and attacks; damage is decided by the server and shown on both screens.
  const maxB = Number(await a.getByTestId('p2-health').getAttribute('data-max'));
  const t0 = Date.now();
  while ((await health(a, 'p2')) >= maxB && Date.now() - t0 < 40_000) {
    const d = await a.evaluate(() => {
      const s = (window as any).__PF?.getState?.();
      return s ? Math.abs(s.fighters[1].x - s.fighters[0].x) : 999;
    });
    if (d > 95) {
      await a.keyboard.down('d');
      await a.waitForTimeout(150);
      await a.keyboard.up('d');
    } else {
      await a.keyboard.press('g', { delay: 40 });
      await a.waitForTimeout(250);
    }
  }
  expect(await health(a, 'p2')).toBeLessThan(maxB);
  // B's client shows the same (authoritative) health once its snapshots catch up.
  await expect.poll(async () => Math.abs((await health(a, 'p2')) - (await health(b, 'p2'))), { timeout: 5000 }).toBeLessThanOrEqual(150);
  await a.waitForTimeout(800);
  expect(await health(b, 'p2')).toBe(await health(a, 'p2'));
  expect(await health(b, 'p2')).toBeLessThan(maxB);

  // B moving is reflected on A's screen.
  const xBefore = await a.evaluate(() => (window as any).__PF.getState().fighters[1].x);
  await b.keyboard.down('a');
  await b.waitForTimeout(250);
  await b.keyboard.down('d');
  await b.keyboard.up('a');
  await b.waitForTimeout(600);
  await b.keyboard.up('d');
  await expect.poll(() => a.evaluate(() => (window as any).__PF.getState().fighters[1].x)).not.toBe(xBefore);

  // Leaving forfeits: A sees the result screen.
  await b.keyboard.press('Escape');
  await b.getByTestId('online-forfeit').click();
  await expect(a.getByTestId('online-results')).toBeVisible({ timeout: 10_000 });
  await expect(a.getByTestId('result-title')).toHaveText('YOU WIN!');
  await expect(b.getByTestId('online-lobby')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
