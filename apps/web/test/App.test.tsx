import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { he } from '@/lib/i18n/he';

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('App shell', () => {
  it('renders Hebrew navigation from the dictionary', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderApp();
    const nav = screen.getByRole('navigation', { name: he['nav.label'] });
    expect(nav).toHaveTextContent(he['nav.clients']);
    expect(nav).toHaveTextContent(he['nav.leads']);
    expect(screen.getByRole('status')).toHaveTextContent(he['system.loading']);
  });

  it('shows healthy status from /api/v1/health', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: { status: 'ok', db: 'ok', version: '0.0.0', time: '2026-01-01T10:00:00.000Z' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderApp();
    expect(await screen.findByText(he['system.ok'])).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('shows an error state when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: { code: 'X', message: 'x' } })),
    );
    renderApp();
    expect(await screen.findByText(he['system.error'])).toBeInTheDocument();
  });
});
