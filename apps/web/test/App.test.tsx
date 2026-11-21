import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { he } from '@/lib/i18n/he';
import { createQueryClient } from '@/lib/queryClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADMIN = {
  id: 'u1',
  email: 'admin@agency.test',
  displayName: 'דנה',
  role: 'admin',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const HEALTH = {
  data: { status: 'ok', db: 'ok', version: '0.0.0', time: '2026-01-01T10:00:00.000Z' },
};

type Route = (url: string, init?: RequestInit) => Response | undefined;
function mockApi(route: Route) {
  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) =>
      route(url, init) ?? json(404, { error: { code: 'NOT_FOUND', message: 'x' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

describe('auth flow (UI)', () => {
  it('shows the Hebrew login page when not authenticated', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
        : undefined,
    );
    renderApp();
    expect(
      await screen.findByRole('heading', { name: new RegExp(he['auth.title']) }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(he['auth.email'])).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText(he['auth.password'])).toHaveAttribute('type', 'password');
  });

  it('shows a generic Hebrew error on bad credentials and clears the password', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      if (url.endsWith('/auth/login'))
        return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } });
    });
    renderApp();
    fireEvent.change(await screen.findByLabelText(he['auth.email']), {
      target: { value: 'a@agency.test' },
    });
    fireEvent.change(screen.getByLabelText(he['auth.password']), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: he['auth.submit'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he['error.INVALID_CREDENTIALS']);
    expect(screen.getByLabelText(he['auth.password'])).toHaveValue('');
  });

  it('shows a Hebrew "no connection" message when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/me'))
          return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
        throw new TypeError('Failed to fetch');
      }),
    );
    renderApp();
    fireEvent.change(await screen.findByLabelText(he['auth.email']), {
      target: { value: 'a@agency.test' },
    });
    fireEvent.change(screen.getByLabelText(he['auth.password']), {
      target: { value: 'whatever-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: he['auth.submit'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he['error.NETWORK']);
  });

  it('logs in with a JSON POST (no token stored in JS) and shows the shell', async () => {
    let loggedIn = false;
    const fetchMock = mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return loggedIn
          ? json(200, { data: { user: ADMIN } })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      if (url.endsWith('/auth/login')) {
        loggedIn = true;
        return json(200, { data: { user: ADMIN } });
      }
      if (url.endsWith('/health')) return json(200, HEALTH);
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderApp();
    fireEvent.change(await screen.findByLabelText(he['auth.email']), {
      target: { value: 'admin@agency.test' },
    });
    fireEvent.change(screen.getByLabelText(he['auth.password']), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: he['auth.submit'] }));

    expect(await screen.findByText(ADMIN.displayName)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: he['nav.users'] })).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login'))!;
    expect(loginCall[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('hides the users page link for non-admins', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return json(200, { data: { user: { ...ADMIN, role: 'employee' } } });
      if (url.endsWith('/health')) return json(200, HEALTH);
    });
    renderApp();
    expect(await screen.findByText(ADMIN.displayName)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: he['nav.users'] })).not.toBeInTheDocument();
  });

  it('any 401 mid-session returns to the login page', async () => {
    let sessionValid = true;
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return sessionValid
          ? json(200, { data: { user: ADMIN } })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      if (url.endsWith('/health')) return json(200, HEALTH);
      if (url.endsWith('/users'))
        return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    renderApp();
    expect(await screen.findByText(ADMIN.displayName)).toBeInTheDocument();
    sessionValid = false;
    fireEvent.click(screen.getByRole('link', { name: he['nav.users'] }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: new RegExp(he['auth.title']) }),
      ).toBeInTheDocument(),
    );
    window.location.hash = '';
  });
});
