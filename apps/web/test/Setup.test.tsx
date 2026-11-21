import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { he } from '@/lib/i18n/he';
import { createQueryClient } from '@/lib/queryClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADMIN = {
  id: 'a1',
  email: 'owner@agency.test',
  displayName: 'הבעלים',
  role: 'admin',
  isActive: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockApi(setupResponse: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me'))
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    if (url.endsWith('/setup/status')) return json(200, { data: { needsSetup: true } });
    if (url.endsWith('/setup') && init?.method === 'POST') return setupResponse();
    if (url.endsWith('/health')) {
      return json(200, {
        data: { status: 'ok', db: 'ok', version: '0.0.0', time: '2026-01-01T10:00:00.000Z' },
      });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderApp = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );

const fill = (code: string) => {
  fireEvent.change(screen.getByLabelText(he['setup.codeLabel']), { target: { value: code } });
  fireEvent.change(screen.getByLabelText(he['signup.displayName']), {
    target: { value: 'הבעלים' },
  });
  fireEvent.change(screen.getByLabelText(he['auth.email']), {
    target: { value: 'owner@agency.test' },
  });
  fireEvent.change(screen.getByLabelText(he['auth.password']), { target: { value: 'Strong12!x' } });
  fireEvent.change(screen.getByLabelText(he['signup.confirmPassword']), {
    target: { value: 'Strong12!x' },
  });
  fireEvent.click(screen.getByRole('button', { name: he['setup.submit'] }));
};

describe('first-run setup page', () => {
  it('replaces the login page while no admin exists, and explains where the code is', async () => {
    mockApi(() => json(201, { data: { user: ADMIN } }));
    renderApp();
    expect(
      await screen.findByRole('heading', { name: new RegExp(he['setup.title']) }),
    ).toBeInTheDocument();
    expect(screen.getByText(he['setup.codeHelp'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: he['auth.signupLink'] })).not.toBeInTheDocument();
  });

  it('requires the code; with it, creates the admin and goes straight to the main screen', async () => {
    const fetchMock = mockApi(() => json(201, { data: { user: ADMIN } }));
    renderApp();
    await screen.findByRole('heading', { name: new RegExp(he['setup.title']) });

    fireEvent.click(screen.getByRole('button', { name: he['setup.submit'] }));
    expect(screen.getByText(he['setup.codeRequired'])).toBeInTheDocument();

    fill('ABCD-EFGH-JKMN');
    expect(await screen.findByText('הבעלים')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: he['nav.users'] })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([u, i]) => String(u).endsWith('/setup') && (i as RequestInit)?.method === 'POST',
    );
    expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
      code: 'ABCD-EFGH-JKMN',
      email: 'owner@agency.test',
    });
  });

  it('shows a Hebrew error for a wrong code', async () => {
    mockApi(() => json(403, { error: { code: 'SETUP_CODE_INVALID', message: 'x' } }));
    renderApp();
    await screen.findByRole('heading', { name: new RegExp(he['setup.title']) });
    fill('WRONG');
    expect(await screen.findByRole('alert')).toHaveTextContent(he['error.SETUP_CODE_INVALID']);
  });
});

describe('session loss mid-use (browser-check regression)', () => {
  it('a 401 on a data request returns to the login page instead of an endless loader', async () => {
    let sessionValid = true;
    const ADMIN_USER = { ...ADMIN };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/me')) {
          return sessionValid
            ? json(200, { data: { user: ADMIN_USER } })
            : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
        }
        // Setup status IS loaded (the case that used to get removed from the cache and hang).
        if (url.endsWith('/setup/status')) return json(200, { data: { needsSetup: false } });
        if (url.endsWith('/auth/options')) return json(200, { data: { signupEnabled: true } });
        if (url.endsWith('/health')) {
          return json(200, {
            data: { status: 'ok', db: 'ok', version: '0.0.0', time: '2026-01-01T10:00:00.000Z' },
          });
        }
        return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      }),
    );
    renderApp();
    expect(await screen.findByText('הבעלים')).toBeInTheDocument();
    sessionValid = false;
    fireEvent.click(screen.getByRole('link', { name: he['nav.clients'] })); // → 401 on the list
    expect(
      await screen.findByRole('heading', { name: new RegExp(he['auth.title']) }),
    ).toBeInTheDocument();
    window.location.hash = '';
  });
});
