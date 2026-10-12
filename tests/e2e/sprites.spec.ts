import { expect, test } from '@playwright/test';
import { measureSuperChecker } from './ingameChecker';

// Regression for the "checkerboard behind Max during his super" bug. Measured on the real
// game canvas: old atlas 1284 checker-grey pixels around Max on frame r3c5, fixed atlas 153
// (remaining = light neutral art: shoe soles, flame edges).
test('no checkerboard appears behind Max Sanchez during his flame-ring super (in-game canvas)', async ({ page }) => {
  const r = await measureSuperChecker(page);
  expect(r.samples).toBeGreaterThan(5);
  expect(r.maxGrey).toBeLessThan(400);
});
