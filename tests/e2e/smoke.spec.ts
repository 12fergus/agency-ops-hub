import { expect, test } from '@playwright/test';

test('production build serves the Hebrew RTL login page and a healthy API', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'he');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: /כניסה למערכת/ })).toBeVisible();

  const health = await request.get('/api/v1/health');
  expect((await health.json()).data).toMatchObject({ status: 'ok', db: 'ok' });
});

test('SPA fallback serves index.html; unknown API routes require a session', async ({
  page,
  request,
}) => {
  const res = await page.goto('/clients/some-route');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const api = await request.get('/api/v1/does-not-exist');
  expect(api.status()).toBe(401);
  expect((await api.json()).error.code).toBe('UNAUTHENTICATED');
});
