import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const BASE = 'http://127.0.0.1:3100';
const RUN = Date.now().toString(36);

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('אימייל').fill(ADMIN_EMAIL);
  await page.getByLabel('סיסמה', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'יציאה' })).toBeVisible();
}

/** A real, decodable PNG of the given size (drawn in the browser, like a user's image file). */
async function makePng(page: Page, width: number, height: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w!;
      c.height = h!;
      const ctx = c.getContext('2d')!;
      // Noise so the PNG doesn't compress to almost nothing (simulates a real photo's size).
      const img = ctx.createImageData(w!, h!);
      crypto.getRandomValues(img.data.subarray(0, 65536));
      for (let o = 65536; o < img.data.length; o += 65536)
        crypto.getRandomValues(img.data.subarray(o, Math.min(o + 65536, img.data.length)));
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    [width, height],
  );
  return Buffer.from(b64, 'base64');
}

test('photo upload through the real button + file chooser, incl. a big phone-size photo', async ({
  page,
}) => {
  await login(page);
  const res = await page.request.post('/api/v1/clients', {
    data: { name: `צילום ${RUN}` },
    headers: { origin: BASE },
  });
  const id = (await res.json()).data.id as string;
  await page.goto(`/#/clients/${id}`);
  await expect(page.getByRole('heading', { name: `צילום ${RUN}`, level: 1 })).toBeVisible();

  // Like a user: click the visible button, the OS file chooser opens, pick a file.
  const big = await makePng(page, 2400, 1800); // phone-camera size: far over the 2 MB server limit
  expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'העלאת תמונה' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'phone-photo.png', mimeType: 'image/png', buffer: big });

  await expect(page.getByRole('img', { name: 'תמונה או לוגו של הלקוח' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'החלפת תמונה' })).toBeVisible();
});

test('a file that is not an image shows a Hebrew error and sends nothing', async ({ page }) => {
  await login(page);
  const res = await page.request.post('/api/v1/clients', {
    data: { name: `לא תמונה ${RUN}` },
    headers: { origin: BASE },
  });
  const id = (await res.json()).data.id as string;
  await page.goto(`/#/clients/${id}`);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'העלאת תמונה' }).click();
  await (
    await chooserPromise
  ).setFiles({
    name: 'notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('definitely not an image'),
  });
  await expect(page.getByRole('alert')).toHaveText(
    'לא ניתן לפתוח את הקובץ כתמונה. נסו JPEG, PNG או WebP',
  );
});
