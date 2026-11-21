import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { he } from '@/lib/i18n/he';
import { createQueryClient } from '@/lib/queryClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NEW_USER = {
  id: 'n1',
  email: 'dana2@agency.test',
  displayName: 'דנה',
  role: 'employee',
  isActive: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockApi(opts: { signupEnabled?: boolean; signup?: () => Response } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me')) {
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    }
    if (url.endsWith('/auth/options')) {
      return json(200, { data: { signupEnabled: opts.signupEnabled ?? true } });
    }
    if (url.endsWith('/auth/signup') && init?.method === 'POST') {
      return (opts.signup ?? (() => json(201, { data: { status: 'active', user: NEW_USER } })))();
    }
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
const posted = (m: ReturnType<typeof vi.fn>, path: string) =>
  m.mock.calls.some(
    ([u, init]) => String(u).endsWith(path) && (init as RequestInit)?.method === 'POST',
  );

afterEach(() => {
  window.location.hash = '';
});

describe('login page validation', () => {
  it('shows Hebrew field errors for empty and invalid input, without calling the API', async () => {
    const fetchMock = mockApi();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: he['auth.submit'] }));
    expect(screen.getByText(he['auth.emailRequired'])).toBeInTheDocument();
    expect(screen.getByText(he['auth.passwordRequired'])).toBeInTheDocument();
    expect(screen.getByLabelText(he['auth.email'])).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText(he['auth.email']), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: he['auth.submit'] }));
    expect(screen.getByText(he['auth.emailInvalid'])).toBeInTheDocument();
    expect(posted(fetchMock, '/auth/login')).toBe(false);
  });

  it('shows the sign-up button only when the server allows it', async () => {
    mockApi({ signupEnabled: false });
    renderApp();
    await screen.findByRole('button', { name: he['auth.submit'] });
    expect(screen.queryByRole('button', { name: he['auth.signupLink'] })).not.toBeInTheDocument();
  });
});

describe('sign-up page', () => {
  const openSignup = async () => {
    fireEvent.click(await screen.findByRole('button', { name: he['auth.signupLink'] }));
    return screen.findByRole('heading', { name: new RegExp(he['signup.title']) });
  };
  const fill = (name: string, email: string, pw: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText(he['signup.displayName']), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(he['auth.email']), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(he['auth.password']), { target: { value: pw } });
    fireEvent.change(screen.getByLabelText(he['signup.confirmPassword']), {
      target: { value: confirm },
    });
  };
  const submit = () => fireEvent.click(screen.getByRole('button', { name: he['signup.submit'] }));

  it('validates every field in Hebrew and does not submit invalid data', async () => {
    const fetchMock = mockApi();
    renderApp();
    await openSignup();
    submit();
    expect(screen.getByText(he['signup.nameRequired'])).toBeInTheDocument();
    expect(screen.getByText(he['auth.emailRequired'])).toBeInTheDocument();
    expect(screen.getByText(he['password.fixFirst'])).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(he['signup.fixErrors']);

    fill('דנה', 'dana2@agency.test', 'Abc12!xy', 'Abc12!xz');
    submit();
    expect(screen.getByText(he['signup.passwordMismatch'])).toBeInTheDocument();
    expect(posted(fetchMock, '/auth/signup')).toBe(false);
  });

  it('default: a valid sign-up logs in and goes straight to the main screen', async () => {
    const fetchMock = mockApi();
    renderApp();
    await openSignup();
    fill('דנה', 'dana2@agency.test', 'Abc12!xy', 'Abc12!xy');
    submit();
    // The shell (main screen) shows the new user's name and the logout button.
    expect(await screen.findByText('דנה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: he['auth.logout'] })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: he['signup.doneTitle'] })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(posted(fetchMock, '/auth/signup')).toBe(true);
  });

  it('approval mode: shows the pending message instead', async () => {
    const fetchMock = mockApi({ signup: () => json(202, { data: { status: 'pending' } }) });
    renderApp();
    await openSignup();
    fill('דנה', 'dana2@agency.test', 'Abc12!xy', 'Abc12!xy');
    submit();
    expect(
      await screen.findByRole('heading', { name: he['signup.doneTitle'] }),
    ).toBeInTheDocument();
    expect(screen.getByText(he['signup.doneText'])).toBeInTheDocument();
    expect(posted(fetchMock, '/auth/signup')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: he['signup.backToLogin'] }));
    expect(
      await screen.findByRole('heading', { name: new RegExp(he['auth.title']) }),
    ).toBeInTheDocument();
  });

  it('shows the server’s Hebrew error (e.g. rate limit)', async () => {
    mockApi({ signup: () => json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }) });
    renderApp();
    await openSignup();
    fill('דנה', 'dana2@agency.test', 'Abc12!xy', 'Abc12!xy');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(he['error.RATE_LIMITED']);
  });
});
