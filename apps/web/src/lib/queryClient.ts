import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

const ME_KEY = ['auth', 'me'];

/**
 * Queries that describe the APP (session, login options, first-run setup) rather than user data.
 * They must survive a logout/401: App.tsx needs them to decide which screen to show, and
 * removing one left the UI stuck on the loading screen (browser-check finding, Phase 3).
 */
export const isAppStateQuery = (key: readonly unknown[]) => key[0] === 'auth' || key[0] === 'setup';

/**
 * Any 401 (session expired, revoked, account disabled) sends the UI back to the login page
 * and drops all cached client data.
 */
export function createQueryClient(): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) {
      client.removeQueries({ predicate: (q) => !isAppStateQuery(q.queryKey) });
      client.setQueryData(ME_KEY, null);
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false } },
  });
  return client;
}
