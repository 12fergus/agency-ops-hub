import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const DESIGNER_EMAIL = 'e2e-designer@agency.test';
const DESIGNER_PASSWORD = `${ADMIN_PASSWORD}-d1!`; // derived per-run test value
const BASE = 'http://127.0.0.1:3100';
const RUN = Date.now().toString(36);

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'יציאה' })).toBeVisible();
}

const api = (req: APIRequestContext) => ({
  post: (path: string, data: unknown) =>
    req.post(`/api/v1${path}`, { data, headers: { origin: BASE } }),
  get: (path: string) => req.get(`/api/v1${path}`),
});

test('call → "צור משימת המשך" → designer works the task from "משימות"', async ({ browser }) => {
  // ---- setup (admin, via API): a client and a designer assigned to it ----
  const adminCtx = await browser.newContext();
  const page = await adminCtx.newPage();
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const a = api(page.request);
  const created = await a.post('/users', {
    email: DESIGNER_EMAIL,
    displayName: `מעצבת ${RUN}`,
    role: 'employee',
    password: DESIGNER_PASSWORD,
  });
  expect([201, 409]).toContain(created.status());
  const users = (await (await a.get('/users')).json()).data as { id: string; email: string }[];
  const designer = users.find((u) => u.email === DESIGNER_EMAIL)!;
  const clientName = `קמפיין ${RUN}`;
  const client = (await (await a.post('/clients', { name: clientName })).json()).data;
  expect((await a.post(`/clients/${client.id}/members`, { userId: designer.id })).status()).toBe(
    201,
  );

  // ---- admin logs the call on the client page ----
  await page.goto(`/#/clients/${client.id}`);
  await expect(page.getByRole('heading', { name: clientName, level: 1 })).toBeVisible();
  const comms = page.getByRole('region', { name: 'תיעוד תקשורת עם הלקוח' });
  await expect(comms.getByText('עדיין לא תועדה תקשורת עם הלקוח')).toBeVisible();
  await comms.getByRole('button', { name: 'תיעוד חדש' }).click();
  const drawer = page.getByRole('dialog', { name: 'תיעוד תקשורת' });
  // Empty summary → Hebrew field error.
  await drawer.getByRole('button', { name: 'שמירה' }).click();
  await expect(drawer.getByText('יש לתקן את השדות המסומנים')).toBeVisible();
  await drawer.getByLabel('סוג').selectOption({ label: 'שיחה' });
  await drawer.getByLabel('מתי').fill('2026-11-23T10:00');
  await drawer
    .getByLabel('סיכום')
    .fill('שוחחנו על קמפיין המטא לנובמבר. הלקוח ביקש שלושה קריאייטיבים חדשים.');
  await drawer.getByRole('button', { name: 'שמירה' }).click();
  await expect(drawer).toBeHidden();
  const record = comms.getByRole('article', { name: /שיחה/ });
  await expect(
    record.getByText('הלקוח ביקש שלושה קריאייטיבים חדשים', { exact: false }),
  ).toBeVisible();
  await expect(record.locator('time')).toHaveText(/23\.11\.2026|23\/11\/2026/); // Israel time
  await expect(record.locator('time')).toHaveText(/10:00/);

  // ---- "צור משימת המשך" from the record ----
  await record.getByRole('button', { name: /צור משימת המשך/ }).click();
  const taskDrawer = page.getByRole('dialog', { name: 'משימת המשך' });
  await expect(taskDrawer.getByText('התיעוד שממנו נוצרת המשימה', { exact: false })).toBeVisible();
  await taskDrawer.getByLabel('כותרת המשימה').fill('הכנת 3 קריאייטיבים חדשים');
  await taskDrawer.getByLabel('אחראי/ת').selectOption({ label: `מעצבת ${RUN}` });
  await taskDrawer.getByLabel('מועד יעד').fill('2026-11-27T17:00');
  await taskDrawer.getByRole('button', { name: 'שמירה' }).click();
  await expect(taskDrawer).toBeHidden();

  // Linked both ways: the record lists its follow-up task, the client's tasks say where it came from.
  await expect(record.getByText('הכנת 3 קריאייטיבים חדשים')).toBeVisible();
  const clientTasks = page.getByRole('region', { name: 'משימות הלקוח' });
  await expect(
    clientTasks.getByRole('button', { name: 'פתיחת המשימה הכנת 3 קריאייטיבים חדשים' }),
  ).toBeVisible();
  await expect(clientTasks.getByText(/נוצרה מתוך: שיחה/)).toBeVisible();

  // An overdue task for the designer (to check the marker).
  await a.post('/tasks', {
    clientId: client.id,
    title: `דוח שבועי ${RUN}`,
    assignedUserId: designer.id,
    dueAt: '2020-01-01T09:00:00Z',
  });

  // ---- the designer: "משימות" shows her queue; she moves the task forward ----
  const desCtx = await browser.newContext();
  const dp = await desCtx.newPage();
  await login(dp, DESIGNER_EMAIL, DESIGNER_PASSWORD);
  await dp
    .getByRole('navigation', { name: 'ניווט ראשי' })
    .getByRole('link', { name: 'משימות' })
    .click();
  await expect(dp.getByRole('heading', { name: 'משימות', level: 1 })).toBeVisible();
  const row = dp.getByRole('row', { name: /הכנת 3 קריאייטיבים חדשים/ });
  await expect(row).toBeVisible();
  await expect(row.getByText(clientName)).toBeVisible();
  await expect(
    dp.getByRole('row', { name: new RegExp(`דוח שבועי ${RUN}`) }).getByText('באיחור'),
  ).toBeVisible();

  // Overdue filter shows only the late one.
  await dp.getByLabel('רק באיחור').check();
  await expect(dp.getByRole('row', { name: /הכנת 3 קריאייטיבים חדשים/ })).toHaveCount(0);
  await dp.getByLabel('רק באיחור').uncheck();

  await row.getByLabel('סטטוס המשימה: הכנת 3 קריאייטיבים חדשים').selectOption({ label: 'בטיפול' });
  await expect(row.getByLabel('סטטוס המשימה: הכנת 3 קריאייטיבים חדשים')).toHaveValue('in_progress');

  // Open it: the drawer explains where it came from; mark it done.
  await row.getByRole('button', { name: 'פתיחת המשימה הכנת 3 קריאייטיבים חדשים' }).click();
  const edit = dp.getByRole('dialog', { name: 'עריכת משימה' });
  await expect(edit.getByText(/נוצרה מתוך: שיחה/)).toBeVisible();
  await edit.getByLabel('סטטוס').selectOption({ label: 'הושלמה' });
  await edit.getByRole('button', { name: 'שמירה' }).click();
  await expect(edit).toBeHidden();
  // Done tasks leave the active queue but are under "הושלמה".
  await expect(dp.getByRole('row', { name: /הכנת 3 קריאייטיבים חדשים/ })).toHaveCount(0);
  await dp.getByLabel('סטטוס', { exact: true }).selectOption({ label: 'הושלמה' });
  await expect(dp.getByRole('row', { name: /הכנת 3 קריאייטיבים חדשים/ })).toBeVisible();

  // The designer can't edit the admin's record, but can create follow-ups from it.
  await dp.goto(`/#/clients/${client.id}`);
  const dRecord = dp.getByRole('region', { name: 'תיעוד תקשורת עם הלקוח' }).getByRole('article', {
    name: /שיחה/,
  });
  await expect(dRecord.getByRole('button', { name: /צור משימת המשך/ })).toBeVisible();
  await expect(dRecord.getByRole('button', { name: /עריכת תיעוד/ })).toHaveCount(0);

  // Archiving from the client page makes the log and tasks read-only at once (no reload).
  await page.goto(`/#/clients/${client.id}`);
  await page.getByRole('button', { name: 'העברה לארכיון' }).click();
  await page.getByRole('button', { name: /^כן/ }).click();
  await expect(page.getByRole('button', { name: 'שחזור מהארכיון' })).toBeVisible();
  const aComms = page.getByRole('region', { name: 'תיעוד תקשורת עם הלקוח' });
  await expect(aComms.getByRole('button', { name: /צור משימת המשך/ })).toHaveCount(0);
  await expect(aComms.getByRole('button', { name: /עריכת תיעוד/ })).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'משימות הלקוח' })
      .getByLabel(/סטטוס המשימה/)
      .first(),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'שחזור מהארכיון' }).click();
  await expect(aComms.getByRole('button', { name: /צור משימת המשך/ })).toBeVisible();

  await adminCtx.close();
  await desCtx.close();
});
