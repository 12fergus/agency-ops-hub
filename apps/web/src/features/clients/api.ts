import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignableUser,
  ClientDto,
  ClientInput,
  ClientListMeta,
  ClientListQuery,
  ClientStaffMember,
  ContactDto,
  ContactInput,
} from '@agency-crm/shared';
import { apiRequest, apiUpload } from '@/lib/api';

/** Path segment encoding for ids (defence in depth; ids are server-generated UUIDs). */
const seg = encodeURIComponent;

/**
 * All clients server state lives in TanStack Query (no extra global cache). Keys include every
 * server-owned parameter so different pages/filters never share a cache entry.
 */
export const clientKeys = {
  all: ['clients'] as const,
  list: (q: ClientListQuery) => ['clients', 'list', q] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
  contacts: (id: string) => ['clients', 'detail', id, 'contacts'] as const,
  staff: (id: string) => ['clients', 'detail', id, 'staff'] as const,
  assignable: ['users', 'assignable'] as const,
};

const toQueryString = (q: ClientListQuery) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  return params.toString();
};

export function useClientList(q: ClientListQuery) {
  return useQuery({
    queryKey: clientKeys.list(q),
    queryFn: async () => {
      const res = await apiRequest<ClientDto[]>('GET', `/clients?${toQueryString(q)}`);
      return { rows: res.data, meta: res.meta as unknown as ClientListMeta };
    },
    placeholderData: keepPreviousData, // keep the table visible while the next page loads
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: async () => (await apiRequest<ClientDto>('GET', `/clients/${seg(id)}`)).data,
  });
}

export function useContacts(id: string) {
  return useQuery({
    queryKey: clientKeys.contacts(id),
    queryFn: async () =>
      (await apiRequest<ContactDto[]>('GET', `/clients/${seg(id)}/contacts`)).data,
  });
}

export function useStaff(id: string) {
  return useQuery({
    queryKey: clientKeys.staff(id),
    queryFn: async () =>
      (await apiRequest<ClientStaffMember[]>('GET', `/clients/${seg(id)}/members`)).data,
  });
}

/** Only admins/managers may call this; pass enabled=false for employees. */
export function useAssignableUsers(enabled: boolean) {
  return useQuery({
    queryKey: clientKeys.assignable,
    queryFn: async () => (await apiRequest<AssignableUser[]>('GET', '/users/assignable')).data,
    enabled,
    staleTime: 60_000,
  });
}

/** After any client write: refresh lists and the affected detail. */
function useInvalidateClient() {
  const qc = useQueryClient();
  return (id?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['clients', 'list'] }),
      // Status usage counts (settings page) change with client creates/archives.
      qc.invalidateQueries({ queryKey: ['client-statuses'] }),
      id ? qc.invalidateQueries({ queryKey: clientKeys.detail(id) }) : Promise.resolve(),
    ]);
}

export function useSaveClient() {
  const invalidate = useInvalidateClient();
  return useMutation({
    mutationFn: async (args: { id?: string; values: ClientInput }) =>
      (
        await (args.id
          ? apiRequest<ClientDto>('PATCH', `/clients/${seg(args.id)}`, args.values)
          : apiRequest<ClientDto>('POST', '/clients', args.values))
      ).data,
    onSuccess: (client) => invalidate(client.id),
  });
}

export function useArchiveClient() {
  const invalidate = useInvalidateClient();
  return useMutation({
    mutationFn: async (args: { id: string; archived: boolean }) =>
      (
        await apiRequest<ClientDto>(
          'POST',
          `/clients/${seg(args.id)}/${args.archived ? 'archive' : 'unarchive'}`,
        )
      ).data,
    onSuccess: (client) => invalidate(client.id),
  });
}

export function useSaveContact(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id?: string; values: ContactInput }) =>
      (
        await (args.id
          ? apiRequest<ContactDto>(
              'PATCH',
              `/clients/${seg(clientId)}/contacts/${seg(args.id)}`,
              args.values,
            )
          : apiRequest<ContactDto>('POST', `/clients/${seg(clientId)}/contacts`, args.values))
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: clientKeys.contacts(clientId) }),
  });
}

export function useDeleteContact(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      apiRequest('DELETE', `/clients/${seg(clientId)}/contacts/${seg(contactId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientKeys.contacts(clientId) }),
  });
}

export function useStaffMutations(clientId: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: clientKeys.staff(clientId) }),
      qc.invalidateQueries({ queryKey: clientKeys.detail(clientId) }),
      qc.invalidateQueries({ queryKey: ['clients', 'list'] }),
    ]);
  const add = useMutation({
    mutationFn: (args: { userId: string; membershipRole: 'owner' | 'collaborator' }) =>
      apiRequest('POST', `/clients/${seg(clientId)}/members`, args),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      apiRequest('DELETE', `/clients/${seg(clientId)}/members/${seg(userId)}`),
    onSuccess: refresh,
  });
  return { add, remove };
}

export function usePhotoMutations(clientId: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: clientKeys.detail(clientId) }),
      qc.invalidateQueries({ queryKey: ['clients', 'list'] }),
    ]);
  const upload = useMutation({
    mutationFn: (file: Blob) => {
      const form = new FormData();
      form.append('photo', file, file instanceof File ? file.name : 'photo');
      return apiUpload(`/clients/${seg(clientId)}/photo`, form);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest('DELETE', `/clients/${seg(clientId)}/photo`),
    onSuccess: refresh,
  });
  return { upload, remove };
}
