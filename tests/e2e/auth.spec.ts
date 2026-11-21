import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const EMP_EMAIL = 'e2e-employee@agency.test';
const EMP_PASSWORD = `${ADMIN_PASSWORD}-emp`; // derived per-run test value

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
}

test('wrong password shows a generic Hebrew error', async ({ page }) => {
  await login(page, ADMIN_EMAIL, 'definitely-wrong-password');
  await expect(page.getByRole('alert')).toHaveText('אימייל או סיסמה שגויים');
});

test('admin: login, HttpOnly cookie, nothing in web storage, navigation on the right', async ({
  page,
  context,
}) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByText('מנהלת בדיקות')).toBeVisible();

  const [cookie] = await context.cookies();
  expect(cookie).toMatchObject({ name: 'crm_session', httpOnly: true, sameSite: 'Lax' });
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    jsCookie: document.cookie,
  }));
  expect(storage).toEqual({ local: [], session: [], jsCookie: '' });

  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  const box = await nav.boundingBox();
  expect(box!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  await expect(page.getByRole('status')).toHaveText('השרת ומסד הנתונים פעילים');
});

test('admin creates an employee; employee logs in without admin access; disable cuts access', async ({
  browser,
}) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.getByRole('link', { name: 'משתמשים' }).click();
  await expect(admin.getByRole('heading', { name: 'ניהול משתמשים' })).toBeVisible();

  const form = admin.getByRole('form', { name: 'משתמש חדש' });
  await form.getByLabel('שם תצוגה').fill('עובד בדיקות');
  await form.getByLabel('אימייל').fill(EMP_EMAIL);
  await form.getByLabel(/סיסמה ראשונית/).fill(EMP_PASSWORD);
  await form.getByRole('button', { name: 'יצירת משתמש' }).click();
  await expect(form.getByRole('status')).toHaveText('המשתמש נוצר');
  const row = admin.getByRole('row', { name: /עובד בדיקות/ });
  await expect(row).toContainText(EMP_EMAIL);
  await expect(row).toContainText('פעיל');

  // Employee session in a separate browser context.
  const empCtx = await browser.newContext();
  const emp = await empCtx.newPage();
  await login(emp, EMP_EMAIL, EMP_PASSWORD);
  await expect(emp.getByText('עובד בדיקות')).toBeVisible();
  await expect(emp.getByRole('link', { name: 'משתמשים' })).toHaveCount(0);
  // Forcing the admin page via URL shows nothing privileged; the API refuses anyway.
  await emp.goto('/#/users');
  await expect(emp.getByRole('heading', { name: 'ניהול משתמשים' })).toHaveCount(0);
  expect((await emp.request.get('/api/v1/users')).status()).toBe(403);

  // Admin disables the employee → the employee's very next API call is rejected.
  await row.getByRole('button', { name: 'השבתה' }).click();
  await expect(row).toContainText('מושבת');
  expect((await emp.request.get('/api/v1/auth/me')).status()).toBe(401);
  await emp.reload();
  await expect(emp.getByRole('heading', { name: /כניסה למערכת/ })).toBeVisible();

  await adminCtx.close();
  await empCtx.close();
});

test('logout revokes the session', async ({ page, context }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByText('מנהלת בדיקות')).toBeVisible();
  const stolen = (await context.cookies())[0]!;

  await page.getByRole('button', { name: 'יציאה' }).click();
  await expect(page.getByRole('heading', { name: /כניסה למערכת/ })).toBeVisible();

  // Replaying the old cookie value server-side fails: the session was revoked, not just deleted.
  const replay = await page.request.get('/api/v1/auth/me', {
    headers: { cookie: `${stolen.name}=${stolen.value}` },
  });
  expect(replay.status()).toBe(401);
});
