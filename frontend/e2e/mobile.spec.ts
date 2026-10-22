import { expect, test } from '@playwright/test';
import { findBookableShow } from './helpers';

test('home, movie and seat map are usable on a phone', async ({ page, request }) => {
  const show = await findBookableShow(request, 2);
  await page.goto('/');
  await expect(page.getByText(/now showing/i).first()).toBeVisible();
  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'e2e/screenshots/30-mobile-home.png' });

  await page.goto(`/movies/${show.slug}`);
  await page.screenshot({ path: 'e2e/screenshots/31-mobile-movie.png' });
  await page.goto(`/book/${show.showtimeId}`);
  const seat = page.getByRole('button', { name: /, available$/ }).first();
  await expect(seat).toBeVisible();
  await seat.click();
  await expect(page.getByRole('button', { name: /^continue/i }).last()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/32-mobile-seats.png' });
});
