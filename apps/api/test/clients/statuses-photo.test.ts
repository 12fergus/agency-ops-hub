import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { addClientMember } from '../../src/modules/clients/service.js';
import { sniffImageType } from '../../src/modules/clients/photo.js';
import { HOST, ORIGIN, call, loginAs, makeUser, testApp } from '../helpers/app.js';

let app: FastifyInstance;
let uploads: string;
const cookie: Record<string, string> = {};
let ids: Record<string, string>;

beforeEach(async () => {
  uploads = mkdtempSync(path.join(tmpdir(), 'crm-uploads-test-'));
  app = await testApp({ UPLOADS_DIR: uploads });
  ids = {
    admin: (await makeUser(app, 'admin@agency.test', 'admin')).id,
    emp: (await makeUser(app, 'emp@agency.test', 'employee')).id,
    other: (await makeUser(app, 'other@agency.test', 'employee')).id,
  };
  for (const k of ['admin', 'emp', 'other']) cookie[k] = await loginAs(app, `${k}@agency.test`);
});
afterEach(async () => {
  await app.close();
  rmSync(uploads, { recursive: true, force: true });
});

const as = (who: string) => ({ cookie: cookie[who]! });

describe('client statuses (admin-defined, colored)', () => {
  it('starts with פעיל (default) / לא פעיל / מושהה in order; anyone logged in can read', async () => {
    const res = await call(app, 'GET', '/api/v1/client-statuses', as('emp'));
    expect(
      res
        .json()
        .data.map((s: { name: string; color: string; isDefault: boolean }) => [
          s.name,
          s.color,
          s.isDefault,
        ]),
    ).toEqual([
      ['פעיל', 'green', true],
      ['לא פעיל', 'gray', false],
      ['מושהה', 'amber', false],
    ]);
  });

  it('admin: create, rename/recolor, set default, reorder, delete unused; others 403', async () => {
    const created = await call(app, 'POST', '/api/v1/client-statuses', {
      ...as('admin'),
      body: { name: 'בהקמה', color: 'blue' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    expect(created.json().data.position).toBe(3);

    // Validation and uniqueness.
    expect(
      (
        await call(app, 'POST', '/api/v1/client-statuses', {
          ...as('admin'),
          body: { name: 'x', color: 'neon' },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(app, 'POST', '/api/v1/client-statuses', {
          ...as('admin'),
          body: { name: 'בהקמה', color: 'red' },
        })
      ).json().error.code,
    ).toBe('STATUS_NAME_TAKEN');

    const patched = await call(app, 'PATCH', `/api/v1/client-statuses/${id}`, {
      ...as('admin'),
      body: { name: 'בהקמה ראשונית', color: 'purple', isDefault: true },
    });
    expect(patched.json().data).toMatchObject({
      name: 'בהקמה ראשונית',
      color: 'purple',
      isDefault: true,
    });
    const all = (await call(app, 'GET', '/api/v1/client-statuses', as('admin'))).json().data as {
      id: string;
      isDefault: boolean;
    }[];
    expect(all.filter((s) => s.isDefault).map((s) => s.id)).toEqual([id]); // exactly one default

    const reordered = await call(app, 'POST', '/api/v1/client-statuses/reorder', {
      ...as('admin'),
      body: { ids: [...all.map((s) => s.id)].reverse() },
    });
    expect(reordered.json().data[0].id).toBe(id);
    expect(
      (
        await call(app, 'POST', '/api/v1/client-statuses/reorder', {
          ...as('admin'),
          body: { ids: [id] },
        })
      ).statusCode,
    ).toBe(422);

    // Default and in-use statuses can't be deleted.
    expect(
      (await call(app, 'DELETE', `/api/v1/client-statuses/${id}`, as('admin'))).json().error.code,
    ).toBe('STATUS_IS_DEFAULT');
    const active = all.find((s) => s.id !== id)!;
    await call(app, 'PATCH', `/api/v1/client-statuses/${active.id}`, {
      ...as('admin'),
      body: { isDefault: true },
    });
    await call(app, 'POST', '/api/v1/clients', {
      ...as('admin'),
      body: { name: 'משתמש בסטטוס', statusId: id },
    });
    expect(
      (await call(app, 'DELETE', `/api/v1/client-statuses/${id}`, as('admin'))).json().error.code,
    ).toBe('STATUS_IN_USE');

    const unused = (
      await call(app, 'POST', '/api/v1/client-statuses', {
        ...as('admin'),
        body: { name: 'זמני', color: 'pink' },
      })
    ).json().data.id;
    expect(
      (await call(app, 'DELETE', `/api/v1/client-statuses/${unused}`, as('admin'))).statusCode,
    ).toBe(200);

    for (const [method, url, body] of [
      ['POST', '/api/v1/client-statuses', { name: 'x', color: 'red' }],
      ['PATCH', `/api/v1/client-statuses/${id}`, { color: 'red' }],
      ['DELETE', `/api/v1/client-statuses/${id}`, undefined],
    ] as const) {
      const res = await call(app, method, url, { ...as('emp'), ...(body ? { body } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

// Minimal valid file headers (sniffing only looks at magic bytes).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(32),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** multipart/form-data body with one file part. */
function upload(
  clientId: string,
  who: string,
  data: Buffer,
  opts: { field?: string; filename?: string; type?: string } = {},
): Promise<LightMyRequestResponse> {
  const boundary = '----crmtest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${opts.field ?? 'photo'}"; filename="${opts.filename ?? 'logo.png'}"\r\nContent-Type: ${opts.type ?? 'image/png'}\r\n\r\n`,
  );
  const body = Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return app.inject({
    method: 'POST',
    url: `/api/v1/clients/${clientId}/photo`,
    headers: {
      host: HOST,
      origin: ORIGIN,
      cookie: cookie[who]!,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

describe('client photo', () => {
  async function clientWithEmp() {
    const res = await call(app, 'POST', '/api/v1/clients', {
      ...as('admin'),
      body: { name: 'עם תמונה' },
    });
    const id = res.json().data.id as string;
    addClientMember(app.dbHandle.db, { clientId: id, userId: ids.emp! }, null);
    return id;
  }

  it('sniffs real image types only', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('a member uploads; members can view it; the stored file name is server-controlled', async () => {
    const id = await clientWithEmp();
    const res = await upload(id, 'emp', JPEG, { filename: '../../evil.png', type: 'image/png' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data.photoType).toBe('image/jpeg'); // from content, not the claim
    expect(readdirSync(path.join(uploads, 'clients'))).toEqual([`${id}.jpg`]);

    const dto = (await call(app, 'GET', `/api/v1/clients/${id}`, as('emp'))).json().data;
    expect(dto.photoUrl).toMatch(new RegExp(`^/api/v1/clients/${id}/photo\\?v=`));

    const img = await call(app, 'GET', `/api/v1/clients/${id}/photo`, as('emp'));
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(JPEG)).toBe(true);

    // Replacing with another format removes the old file.
    expect((await upload(id, 'emp', PNG)).statusCode).toBe(201);
    expect(readdirSync(path.join(uploads, 'clients'))).toEqual([`${id}.png`]);
  });

  it('rejects SVG/other content, oversized files and the wrong field', async () => {
    const id = await clientWithEmp();
    expect(
      (await upload(id, 'emp', SVG, { filename: 'x.png', type: 'image/png' })).json().error.code,
    ).toBe('PHOTO_TYPE');
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload(id, 'emp', big)).statusCode).toBe(413);
    expect((await upload(id, 'emp', PNG, { field: 'other' })).statusCode).toBe(422);
    expect(existsSync(path.join(uploads, 'clients', `${id}.png`))).toBe(false);
  });

  it('non-members get 404 for viewing and uploading; unauthenticated 401; CSRF applies', async () => {
    const id = await clientWithEmp();
    await upload(id, 'emp', PNG);
    expect((await call(app, 'GET', `/api/v1/clients/${id}/photo`, as('other'))).statusCode).toBe(
      404,
    );
    expect((await upload(id, 'other', PNG)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/clients/${id}/photo`,
          headers: { host: HOST },
        })
      ).statusCode,
    ).toBe(401);
    const csrf = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${id}/photo`,
      headers: {
        host: HOST,
        origin: 'http://evil.test',
        cookie: cookie.emp!,
        'content-type': 'multipart/form-data; boundary=x',
      },
      payload: '--x--',
    });
    expect(csrf.statusCode).toBe(403);
  });

  it('delete removes the file and the URL', async () => {
    const id = await clientWithEmp();
    await upload(id, 'emp', PNG);
    expect((await call(app, 'DELETE', `/api/v1/clients/${id}/photo`, as('emp'))).statusCode).toBe(
      200,
    );
    expect(existsSync(path.join(uploads, 'clients', `${id}.png`))).toBe(false);
    expect(
      (await call(app, 'GET', `/api/v1/clients/${id}`, as('emp'))).json().data.photoUrl,
    ).toBeNull();
    expect((await call(app, 'GET', `/api/v1/clients/${id}/photo`, as('emp'))).statusCode).toBe(404);
  });
});

describe('review fixes (statuses + photos)', () => {
  it('status usage counts are admin-only (no leak of agency-wide client numbers)', async () => {
    await call(app, 'POST', '/api/v1/clients', { ...as('admin'), body: { name: 'א' } });
    const adminView = (await call(app, 'GET', '/api/v1/client-statuses', as('admin'))).json().data;
    const empView = (await call(app, 'GET', '/api/v1/client-statuses', as('emp'))).json().data;
    expect(adminView.find((s: { isDefault: boolean }) => s.isDefault).clientCount).toBe(1);
    expect(empView.every((s: { clientCount: unknown }) => s.clientCount === null)).toBe(true);
  });

  it('PATCH with a deleted / unknown statusId is a field error (422), not a 500', async () => {
    const id = (
      await call(app, 'POST', '/api/v1/clients', { ...as('admin'), body: { name: 'ב' } })
    ).json().data.id;
    const tmp = (
      await call(app, 'POST', '/api/v1/client-statuses', {
        ...as('admin'),
        body: { name: 'זמני', color: 'red' },
      })
    ).json().data.id;
    await call(app, 'DELETE', `/api/v1/client-statuses/${tmp}`, as('admin'));
    const res = await call(app, 'PATCH', `/api/v1/clients/${id}`, {
      ...as('admin'),
      body: { statusId: tmp },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toEqual([{ path: 'statusId', code: 'invalid_value' }]);
  });

  it('photos are privately cacheable (versioned URL); other API responses stay no-store', async () => {
    const id = (
      await call(app, 'POST', '/api/v1/clients', { ...as('admin'), body: { name: 'ג' } })
    ).json().data.id;
    addClientMember(app.dbHandle.db, { clientId: id, userId: ids.emp! }, null);
    await upload(id, 'emp', PNG);
    const img = await call(app, 'GET', `/api/v1/clients/${id}/photo`, as('emp'));
    expect(img.headers['cache-control']).toBe('private, max-age=86400');
    const json = await call(app, 'GET', `/api/v1/clients/${id}`, as('emp'));
    expect(json.headers['cache-control']).toBe('no-store');
  });

  it('if the DB update fails, the CURRENT photo survives and no temp file is left', async () => {
    const id = (
      await call(app, 'POST', '/api/v1/clients', { ...as('admin'), body: { name: 'ד' } })
    ).json().data.id;
    addClientMember(app.dbHandle.db, { clientId: id, userId: ids.emp! }, null);
    expect((await upload(id, 'emp', PNG)).statusCode).toBe(201);

    // Simulate a DB failure (e.g. disk full) on the next photo update.
    app.dbHandle.sqlite.exec(
      `CREATE TRIGGER fail_photo BEFORE UPDATE OF photo_type ON clients BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`,
    );
    const failed = await upload(id, 'emp', JPEG);
    expect(failed.statusCode).toBe(500);
    app.dbHandle.sqlite.exec('DROP TRIGGER fail_photo');

    expect(readdirSync(path.join(uploads, 'clients')).sort()).toEqual([`${id}.png`]); // old kept, no .uploading
    const img = await call(app, 'GET', `/api/v1/clients/${id}/photo`, as('emp'));
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  });
});
