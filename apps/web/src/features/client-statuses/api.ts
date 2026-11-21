import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientStatusDto, StatusColor } from '@agency-crm/shared';
import { apiRequest } from '@/lib/api';

export const statusKeys = { all: ['client-statuses'] as const };

/** Admin-defined client statuses (readable by every logged-in user). */
export function useClientStatuses() {
  return useQuery({
    queryKey: statusKeys.all,
    queryFn: async () => (await apiRequest<ClientStatusDto[]>('GET', '/client-statuses')).data,
    staleTime: 60_000,
  });
}

/** After a status change, the status list AND every client view (badges) are refreshed. */
function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: statusKeys.all }),
      qc.invalidateQueries({ queryKey: ['clients'] }),
    ]);
}

export function useStatusMutations() {
  const refresh = useRefresh();
  const enc = encodeURIComponent;
  return {
    create: useMutation({
      mutationFn: (v: { name: string; color: StatusColor }) =>
        apiRequest<ClientStatusDto>('POST', '/client-statuses', v),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; name?: string; color?: StatusColor; isDefault?: true }) => {
        const { id, ...patch } = v;
        return apiRequest<ClientStatusDto>('PATCH', `/client-statuses/${enc(id)}`, patch);
      },
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => apiRequest('POST', '/client-statuses/reorder', { ids }),
      onSuccess: refresh,
      // e.g. another admin added a status meanwhile → reload the list so the next move works.
      onError: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiRequest('DELETE', `/client-statuses/${enc(id)}`),
      onSuccess: refresh,
    }),
  };
}
