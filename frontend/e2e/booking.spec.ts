import { expect, test, type Page } from '@playwright/test';
import { findBookableShow } from './helpers';

const shots = 'e2e/screenshots';

async function snap(page: Page, name: string) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

test.describe.configure({ mode: 'serial' });

test('guest books two seats, pays with the simulator and gets a ticket and invoice', async ({ page, request }) => {
  const show = await findBookableShow(request);
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('/');
  await expect(page.getByRole('link', { name: /practice project/i }).first()).toBeVisible();
  await expect(page.getByText(/now showing/i).first()).toBeVisible();
  await snap(page, '01-home');

  await page.goto(`/movies/${show.slug}`);
  await expect(page.getByRole('heading', { name: show.title }).first()).toBeVisible();
  await expect(page.getByText(/development data/i).first()).toBeVisible();
  await snap(page, '02-movie-detail');

  // Use the open show found via the API (the first chip of the day may already have closed for sales).
  await page.goto(`/book/${show.showtimeId}`);

  await expect(page).toHaveURL(/\/book\/\d+/);
  const available = page.getByRole('button', { name: /, available$/ });
  await expect(available.first()).toBeVisible();
  const count = await available.count();
  // Pick two seats from the middle of the hall.
  await available.nth(Math.floor(count / 2)).click();
  await available.nth(Math.floor(count / 2)).click();
  await expect(page.getByRole('button', { name: /, selected$/ })).toHaveCount(2);
  await snap(page, '03-seat-selection');

  await page.getByRole('button', { name: /^continue/i }).first().click();
  await expect(page).toHaveURL(/\/checkout\/PP[A-Z0-9]+/);
  const reference = page.url().split('/checkout/')[1];

  await page.getByLabel('Full name').fill('E2E Guest');
  await page.getByLabel('Email').fill('e2e.guest@example.com');
  await page.getByLabel('Phone').fill('9800000001');
  await page.getByLabel('Offer code').fill('FLAT100');
  await page.getByRole('button', { name: /^apply$/i }).click();
  await expect(page.getByText('FLAT100').first()).toBeVisible();

  await page.getByText(/simulator/i).first().click();
  await snap(page, '04-checkout');
  await page.getByRole('button', { name: /^pay rs\./i }).first().click();

  // Backend-hosted simulator ("gateway") page.
  await expect(page.getByText(/development simulator/i)).toBeVisible();
  await snap(page, '05-payment-simulator');
  await page.getByRole('button', { name: 'Approve payment' }).click();

  await expect(page).toHaveURL(new RegExp(`/bookings/${reference}`));
  await expect(page.getByText(/you're all set/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: /qr/i }).first()).toBeVisible();
  await snap(page, '06-confirmed-ticket');

  const invoiceLink = page.locator('a[href*="/invoices/PP-INV-"]').first();
  await expect(invoiceLink).toBeVisible();
  await invoiceLink.click();
  await expect(page.getByText(/PP-INV-\d{4}-\d{6}/).first()).toBeVisible();
  await snap(page, '07-invoice');

  expect(consoleErrors.filter((e) => !/favicon|EventSource/i.test(e))).toEqual([]);
});

test('a second browser cannot take seats that are already held', async ({ browser, request }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();

  const { showtimeId } = await findBookableShow(request, 1);

  await pa.goto(`/book/${showtimeId}`);
  await pb.goto(`/book/${showtimeId}`);
  const seatName = (await pa.getByRole('button', { name: /, available$/ }).nth(3).getAttribute('aria-label'))!;
  const label = seatName.split(',')[0]; // "Seat B4"

  await pa.getByRole('button', { name: new RegExp(`^${label},`) }).click();
  await pa.getByRole('button', { name: /^continue/i }).first().click();
  await expect(pa).toHaveURL(/\/checkout\//);

  // Browser B sees the seat turn "held" via the live stream (or its fallback refetch).
  await expect(pb.getByRole('button', { name: new RegExp(`^${label},.*held`, 'i') })).toBeVisible({ timeout: 20_000 });
  await snap(pb, '08-seat-held-by-someone-else');
  await a.close();
  await b.close();
});

test('admin signs in and the back office pages load', async ({ page }) => {
  await page.goto('/login?next=/admin');
  await page.getByLabel('Email').fill('admin@practice-project.local');
  await page.locator('input[name="password"]').fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page).toHaveURL(/\/admin/);

  const pages: [string, string][] = [
    ['/admin', '10-admin-dashboard'],
    ['/admin/movies', '11-admin-movies'],
    ['/admin/cinemas', '12-admin-cinemas'],
    ['/admin/showtimes', '13-admin-showtimes'],
    ['/admin/bookings', '14-admin-bookings'],
    ['/admin/payments', '15-admin-payments'],
    ['/admin/refunds', '16-admin-refunds'],
    ['/admin/billing', '17-admin-billing'],
    ['/admin/coupons', '18-admin-coupons'],
    ['/admin/users', '19-admin-users'],
    ['/admin/reports', '20-admin-reports'],
    ['/admin/settings', '21-admin-settings'],
    ['/admin/audit', '22-admin-audit'],
  ];
  for (const [path, name] of pages) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/couldn.t load|something went wrong|failed to load/i)).toHaveCount(0);
    await snap(page, name);
  }

  // Seat layout editor for the first seeded auditorium.
  await page.goto('/admin/auditoriums/1/layout');
  await expect(page.getByText(/couldn.t load|something went wrong|failed to load/i)).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await snap(page, '23-admin-layout-editor');
});
