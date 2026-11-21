import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;

test('sidebar links switch pages both ways; only <main> scrolls, header stays visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 500 }); // short window → users page overflows
  await page.goto('/');
  await page.getByLabel('אימייל').fill(ADMIN_EMAIL);
  await page.getByLabel('סיסמה', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('השרת ומסד הנתונים פעילים');

  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });

  // ראשי → משתמשים
  await nav.getByRole('link', { name: 'משתמשים' }).click();
  await expect(page).toHaveURL(/#\/users$/);
  await expect(page.getByRole('heading', { name: 'ניהול משתמשים' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'משתמשים' })).toHaveAttribute('aria-current', 'page');

  // No second (document-level) scrollbar: the page itself never scrolls…
  const pageScroll = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight - window.innerHeight,
    main: (() => {
      const m = document.querySelector('main')!;
      return m.scrollHeight - m.clientHeight;
    })(),
  }));
  expect(pageScroll.doc).toBeLessThanOrEqual(0);
  expect(pageScroll.main).toBeGreaterThan(0); // …the content area does

  // Scrolling the content to the bottom keeps the header (logout) visible.
  await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight));
  await expect(page.getByRole('button', { name: 'יציאה' })).toBeInViewport();

  // משתמשים → ראשי
  await nav.getByRole('link', { name: 'ראשי' }).click();
  await expect(page.getByRole('status')).toHaveText('השרת ומסד הנתונים פעילים');
  await expect(page.getByRole('heading', { name: 'ניהול משתמשים' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'ראשי' })).toHaveAttribute('aria-current', 'page');
});
