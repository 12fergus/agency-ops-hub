import { expect, test } from '@playwright/test';

test('production build serves the Hebrew RTL shell with a healthy API', async ({ page }) => {
  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'he');
  await expect(html).toHaveAttribute('dir', 'rtl');

  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  await expect(nav).toContainText('לקוחות');

  // Navigation sits on the right side in RTL.
  const navBox = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(navBox && viewport && navBox.x > viewport.width / 2).toBeTruthy();

  await expect(page.getByRole('status')).toHaveText('השרת ומסד הנתונים פעילים');
});

test('SPA fallback serves index.html for client routes, API 404s stay JSON', async ({
  page,
  request,
}) => {
  const res = await page.goto('/clients/some-route');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const api = await request.get('/api/v1/does-not-exist');
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});
