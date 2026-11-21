import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const EMP_EMAIL = 'e2e-clients-emp@agency.test';
const EMP_PASSWORD = `${ADMIN_PASSWORD}-c1!`; // derived per-run test value
const BASE = 'http://127.0.0.1:3100';
const RUN = Date.now().toString(36); // unique names per run (shared e2e DB)

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'יציאה' })).toBeVisible();
}

/** API helper using the page's session cookie; state-changing calls need a same-origin Origin. */
const api = (req: APIRequestContext) => ({
  post: (path: string, data: unknown) =>
    req.post(`/api/v1${path}`, { data, headers: { origin: BASE } }),
  get: (path: string) => req.get(`/api/v1${path}`),
});

test.describe.configure({ mode: 'serial' });

test('admin: create/edit/contacts/staff/filters/archive; employee sees only assigned client', async ({
  browser,
}) => {
  const adminCtx = await browser.newContext();
  const page = await adminCtx.newPage();
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const a = api(page.request);

  // Test employee (created through the admin API).
  const emp = await a.post('/users', {
    email: EMP_EMAIL,
    displayName: `עובדת לקוחות ${RUN}`,
    role: 'employee',
    password: EMP_PASSWORD,
  });
  expect([201, 409]).toContain(emp.status());

  // ---- create via the drawer, with RTL validation ----
  await page
    .getByRole('navigation', { name: 'ניווט ראשי' })
    .getByRole('link', { name: 'לקוחות' })
    .click();
  await expect(page.getByRole('heading', { name: 'לקוחות', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'לקוח חדש' }).click();
  const drawer = page.getByRole('dialog', { name: 'לקוח חדש' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel(/שם הלקוח/)).toBeFocused();

  await drawer.getByRole('button', { name: 'יצירת לקוח' }).click();
  await expect(drawer.getByText('שדה חובה')).toBeVisible();
  await expect(drawer.getByRole('alert')).toHaveText('יש לתקן את השדות המסומנים');

  const name = `מרפאת בדיקה ${RUN}`;
  await drawer.getByLabel(/שם הלקוח/).fill(name);
  await drawer.getByLabel('אימייל').fill('not-an-email');
  await drawer.getByLabel('טלפון').fill('abc');
  await drawer.getByRole('button', { name: 'יצירת לקוח' }).click();
  await expect(drawer.getByText('כתובת אימייל לא תקינה')).toBeVisible();
  await expect(drawer.getByText(/מספר טלפון יכול לכלול רק ספרות/)).toBeVisible();

  await drawer.getByLabel('אימייל').fill('office@clinic-e2e.test');
  await drawer.getByLabel('טלפון').fill('050-1234567');
  await drawer.getByLabel('שם העסק').fill('קליניקה בע״מ');
  await drawer.getByRole('button', { name: 'יצירת לקוח' }).click();

  // Lands on the detail page; phone/email render LTR inside the RTL page.
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/clients\/[0-9a-f-]{36}$/);
  const clientId = page.url().split('/').pop()!;
  await expect(page.getByText('050-1234567')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByText('office@clinic-e2e.test')).toHaveAttribute('dir', 'ltr');

  // ---- edit; Escape closes the drawer ----
  await page.getByRole('button', { name: 'עריכה' }).click();
  const edit = page.getByRole('dialog', { name: 'עריכת לקוח' });
  await edit.getByLabel('תחום').fill('רפואת שיניים');
  await edit.getByRole('button', { name: 'שמירת שינויים' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('רפואת שיניים')).toBeVisible();
  await page.getByRole('button', { name: 'עריכה' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ---- contacts ----
  await page.getByRole('button', { name: 'איש קשר חדש' }).click();
  const cd = page.getByRole('dialog', { name: 'איש קשר חדש' });
  await cd.getByLabel(/^שם/).fill('ד״ר רונית');
  await cd.getByLabel('תפקיד').fill('בעלת המרפאה');
  await cd.getByLabel('איש קשר ראשי').check();
  await cd.getByRole('button', { name: 'שמירה' }).click();
  const contacts = page.getByRole('region', { name: 'אנשי קשר' });
  await expect(contacts).toContainText('ד״ר רונית');
  await expect(contacts).toContainText('ראשי');

  // ---- assigned staff ----
  const staff = page.getByRole('region', { name: 'צוות משויך' });
  await staff
    .getByLabel('משתמש', { exact: true })
    .selectOption({ label: `עובדת לקוחות ${RUN} (עובד/ת)` });
  await staff.getByRole('button', { name: 'שיוך' }).click();
  await expect(staff).toContainText(`עובדת לקוחות ${RUN}`);

  // ---- photo upload (hidden file input behind the button) ----
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('#client-photo-input')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'תמונה או לוגו של הלקוח' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'החלפת תמונה' })).toBeVisible();

  // ---- custom statuses: the default is פעיל (green); change it in the edit drawer ----
  await expect(page.locator('[data-color="green"]').first()).toContainText('פעיל');
  const statuses = (await (await a.get('/client-statuses')).json()).data as {
    id: string;
    name: string;
  }[];
  const pausedId = statuses.find((x) => x.name === 'מושהה')!.id;

  // ---- list: search / status / owner filters ----
  const other = await a.post('/clients', { name: `לקוח מושהה ${RUN}`, statusId: pausedId });
  expect(other.status()).toBe(201);
  await page.getByRole('button', { name: /חזרה לרשימת הלקוחות/ }).click();
  const table = page.getByRole('table', { name: 'לקוחות' });
  await page.getByLabel('חיפוש לקוחות').fill(RUN);
  await expect(table.getByRole('row')).toHaveCount(3); // header + 2
  await page.getByLabel('סטטוס', { exact: true }).selectOption({ label: 'מושהה' });
  await expect(table).toContainText(`לקוח מושהה ${RUN}`);
  await expect(table).not.toContainText(name);
  await expect(table.locator('[data-color="amber"]').first()).toContainText('מושהה'); // colored
  await page.getByLabel('סטטוס', { exact: true }).selectOption({ label: 'כל הסטטוסים' });
  await page.getByLabel('חיפוש לקוחות').fill('לא-קיים-בכלל-xyz');
  await expect(table).toContainText('אין לקוחות שתואמים לחיפוש או לסינון');
  await page.getByLabel('חיפוש לקוחות').fill(RUN);

  // ---- archive preserves the record ----
  await table.getByRole('button', { name }).click();
  await page.getByRole('button', { name: 'העברה לארכיון' }).click();
  await page
    .getByRole('group', { name: /להעביר לארכיון/ })
    .getByRole('button', { name: /^כן/ })
    .click();
  await expect(page.getByRole('note')).toContainText('הלקוח בארכיון');
  await expect(page.getByRole('button', { name: 'עריכה' })).toHaveCount(0); // read-only
  await expect(page.getByRole('region', { name: 'אנשי קשר' })).toContainText('ד״ר רונית'); // kept

  await page.getByRole('button', { name: /חזרה לרשימת הלקוחות/ }).click();
  await page.getByLabel('חיפוש לקוחות').fill(RUN);
  await expect(table).not.toContainText(name);
  await page.getByLabel('הצגה').selectOption({ label: 'בארכיון' });
  await expect(table).toContainText(name);

  // ---- settings: admin adds a status with a color ----
  await page.getByRole('link', { name: 'הגדרות' }).click();
  await page.getByLabel('שם הסטטוס', { exact: true }).fill(`בהקמה ${RUN}`);
  await page.getByLabel('צבע', { exact: true }).selectOption({ label: 'סגול' });
  await page.getByRole('button', { name: 'הוספת סטטוס' }).click();
  await expect(page.locator('ol [data-color="purple"]')).toContainText(`בהקמה ${RUN}`);

  // Restore it for the employee check.
  expect((await a.post(`/clients/${clientId}/unarchive`, {})).status()).toBe(200);

  // ---- employee: sees only assigned clients; may edit them and create new ones ----
  const empCtx = await browser.newContext();
  const ep = await empCtx.newPage();
  await login(ep, EMP_EMAIL, EMP_PASSWORD);
  await ep.getByRole('link', { name: 'לקוחות' }).click();
  const empTable = ep.getByRole('table', { name: 'לקוחות' });
  await expect(empTable).toContainText(name);
  await expect(empTable).not.toContainText(`לקוח מושהה ${RUN}`);
  await expect(ep.getByLabel('אחראי/ת')).toHaveCount(0); // no owner filter for employees

  await empTable.getByRole('button', { name }).click();
  await expect(ep.getByRole('heading', { name, level: 1 })).toBeVisible();
  for (const btn of ['העברה לארכיון', 'שיוך']) {
    await expect(ep.getByRole('button', { name: btn })).toHaveCount(0); // admin/owner only
  }
  // Assigned employee edits the status.
  await ep.getByRole('button', { name: 'עריכה', exact: true }).click();
  const epEdit = ep.getByRole('dialog', { name: 'עריכת לקוח' });
  await epEdit.getByLabel('סטטוס').selectOption({ label: 'לא פעיל' });
  await epEdit.getByRole('button', { name: 'שמירת שינויים' }).click();
  await expect(ep.locator('header [data-color="gray"]')).toContainText('לא פעיל');

  // Employee creates a client and is assigned to it automatically.
  await ep.getByRole('button', { name: /חזרה לרשימת הלקוחות/ }).click();
  await ep.getByRole('button', { name: 'לקוח חדש' }).click();
  const epNew = ep.getByRole('dialog', { name: 'לקוח חדש' });
  await epNew.getByLabel(/שם הלקוח/).fill(`לקוח של העובדת ${RUN}`);
  await epNew.getByRole('button', { name: 'יצירת לקוח' }).click();
  await expect(ep.getByRole('heading', { name: `לקוח של העובדת ${RUN}`, level: 1 })).toBeVisible();
  await expect(ep.getByRole('region', { name: 'צוות משויך' })).toContainText(`עובדת לקוחות ${RUN}`);

  // Direct URL to a client she isn't assigned to → "not found", no data.
  const otherId = (await other.json()).data.id as string;
  await ep.goto(`/#/clients/${otherId}`);
  await expect(ep.getByRole('alert')).toHaveText('הלקוח לא נמצא או שאין לך גישה אליו');
  await expect(ep.getByText(`לקוח מושהה ${RUN}`)).toHaveCount(0);

  await empCtx.close();
  await adminCtx.close();
});
