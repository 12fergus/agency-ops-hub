import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LoginInput, UserDto } from '@agency-crm/shared';
import { ApiRequestError, apiRequest } from '@/lib/api';

export const ME_KEY = ['auth', 'me'] as const;

/** Current user, or null when not logged in. Source of truth is the server session. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<UserDto | null> => {
      try {
        return (await apiRequest<{ user: UserDto }>('GET', '/auth/me')).data.user;
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Forget everything cached for the previous user, but keep the session query itself
 * (the App is subscribed to it; removing it would leave the UI stuck on the old state).
 */
function dropUserData(qc: QueryClient) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => apiRequest<{ user: UserDto }>('POST', '/auth/login', input),
    onSuccess: (res) => {
      dropUserData(qc);
      qc.setQueryData(ME_KEY, res.data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('POST', '/auth/logout'),
    // Drop all cached data on logout (even if the request failed, the UI forgets the user).
    onSettled: () => {
      dropUserData(qc);
      qc.setQueryData(ME_KEY, null);
    },
  });
}

/** Public login-page options (e.g. whether self-signup is enabled). */
export function useAuthOptions() {
  return useQuery({
    queryKey: ['auth', 'options'],
    queryFn: async () =>
      (await apiRequest<{ signupEnabled: boolean }>('GET', '/auth/options')).data,
    staleTime: Infinity,
  });
}

export const SETUP_KEY = ['setup', 'status'] as const;

/** True while the server has no admin yet → show the first-run setup page instead of login. */
export function useSetupStatus() {
  return useQuery({
    queryKey: SETUP_KEY,
    queryFn: async () => (await apiRequest<{ needsSetup: boolean }>('GET', '/setup/status')).data,
    staleTime: Infinity,
  });
}
