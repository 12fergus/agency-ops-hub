import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { UsersPage } from '@/features/users/UsersPage';
import { he } from '@/lib/i18n/he';
import { createQueryClient } from '@/lib/queryClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CREATED = {
  id: 'n',
  email: 'new@agency.test',
  displayName: 'N',
  role: 'employee',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function setup(postResponse: () => Response = () => json(201, { data: CREATED })) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? postResponse() : json(200, { data: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <UsersPage currentUserId="me" />
    </QueryClientProvider>,
  );
  const form = within(screen.getByRole('form', { name: he['users.createTitle'] }));
  const fill = (email: string, password: string) => {
    fireEvent.change(form.getByLabelText(he['users.displayName']), { target: { value: 'עובד' } });
    fireEvent.change(form.getByLabelText(he['auth.email']), { target: { value: email } });
    fireEvent.change(form.getByLabelText(he['users.initialPassword']), {
      target: { value: password },
    });
  };
  const submit = () => fireEvent.click(form.getByRole('button', { name: he['users.create'] }));
  return { fetchMock, form, fill, submit };
}

const rule = (r: string) => document.querySelector(`[data-rule="${r}"]`)!;
const posted = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('password rules in the create-user form', () => {
  it('shows the rules in Hebrew and ticks them off live', () => {
    const { form } = setup();
    expect(form.getByText(he['password.rule.PASSWORD_NEEDS_SYMBOL'])).toBeInTheDocument();
    const pw = form.getByLabelText(he['users.initialPassword']);
    expect(pw).toHaveAttribute('aria-describedby', 'new-password-rules');

    fireEvent.change(pw, { target: { value: 'abc' } });
    expect(rule('PASSWORD_NEEDS_LETTER')).toHaveAttribute('data-ok', 'true');
    expect(rule('PASSWORD_NEEDS_DIGIT')).toHaveAttribute('data-ok', 'false');
    expect(rule('PASSWORD_NEEDS_SYMBOL')).toHaveAttribute('data-ok', 'false');

    fireEvent.change(pw, { target: { value: 'abc12!xy' } });
    for (const r of [
      'PASSWORD_TOO_SHORT',
      'PASSWORD_NEEDS_LETTER',
      'PASSWORD_NEEDS_DIGIT',
      'PASSWORD_NEEDS_SYMBOL',
    ]) {
      expect(rule(r)).toHaveAttribute('data-ok', 'true');
    }
  });

  it('blocks submit with a Hebrew message while rules are unmet; submits once met', async () => {
    const { form, fetchMock, fill, submit } = setup();
    fill('new@agency.test', 'abcdefgh');
    submit();
    expect(await form.findByRole('alert')).toHaveTextContent(he['password.fixFirst']);
    expect(posted(fetchMock)).toBe(false);

    fill('new@agency.test', 'abcdefg1!');
    submit();
    expect(await form.findByRole('status')).toHaveTextContent(he['users.created']);
    expect(posted(fetchMock)).toBe(true);
  });

  it('shows the server’s specific rule message if the server rejects the password', async () => {
    const { form, fill, submit } = setup(() =>
      json(422, { error: { code: 'VALIDATION', message: 'PASSWORD_CONTAINS_EMAIL' } }),
    );
    fill('zz@agency.test', 'abcdefg1!');
    submit();
    expect(await form.findByRole('alert')).toHaveTextContent(he['error.PASSWORD_CONTAINS_EMAIL']);
  });
});
