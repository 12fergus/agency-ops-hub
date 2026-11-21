import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

const ME_KEY = ['auth', 'me'];

/**
 * Any 401 (session expired, revoked, account disabled) sends the UI back to the login page
 * and drops all cached client data.
 */
export function createQueryClient(): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) {
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
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
