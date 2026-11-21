import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const NEW_EMAIL = 'e2e-signup@agency.test';
const NEW_PASSWORD = `${ADMIN_PASSWORD}-new1!`; // derived per-run test value

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
}

test('sign-up logs straight in to the main screen, with no admin access', async ({ browser }) => {
  // 1. Sign up from the login page.
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto('/');
  await visitor.getByRole('button', { name: 'הרשמה' }).click();
  await expect(visitor.getByRole('heading', { name: /הרשמה למערכת/ })).toBeVisible();

  // Field errors appear in Hebrew when submitting empty.
  await visitor.getByRole('button', { name: 'שליחת בקשת הרשמה' }).click();
  await expect(visitor.getByText('יש להזין שם')).toBeVisible();
  await expect(visitor.getByText('יש להזין אימייל')).toBeVisible();

  await visitor.getByLabel('שם מלא').fill('נרשם בדיקות');
  await visitor.getByLabel('אימייל').fill(NEW_EMAIL);
  await visitor.getByLabel('סיסמה', { exact: true }).fill(NEW_PASSWORD);
  await visitor.getByLabel('אימות סיסמה').fill(NEW_PASSWORD);
  await visitor.getByRole('button', { name: 'שליחת בקשת הרשמה' }).click();

  // 2. Straight to the main screen, logged in as an employee (no users page).
  await expect(visitor.getByText('נרשם בדיקות')).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'יציאה' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: 'משתמשים' })).toHaveCount(0);
  await expect(visitor.getByRole('status')).toHaveText('השרת ומסד הנתונים פעילים');
  const [cookie] = await visitorCtx.cookies();
  expect(cookie).toMatchObject({ name: 'crm_session', httpOnly: true });
  expect((await visitor.request.get('/api/v1/users')).status()).toBe(403);

  // 3. Logout, then the same credentials log in normally.
  await visitor.getByRole('button', { name: 'יציאה' }).click();
  await login(visitor, NEW_EMAIL, NEW_PASSWORD);
  await expect(visitor.getByText('נרשם בדיקות')).toBeVisible();

  // 4. The admin sees the new account as an active employee.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.getByRole('link', { name: 'משתמשים' }).click();
  const row = admin.getByRole('row', { name: /נרשם בדיקות/ });
  await expect(row).toContainText('פעיל');
  await expect(row).toContainText('עובד/ת');

  await visitorCtx.close();
  await adminCtx.close();
});
