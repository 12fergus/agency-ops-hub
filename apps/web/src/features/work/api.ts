import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommunicationDto,
  CommunicationInput,
  TaskDto,
  TaskInput,
  TaskListQuery,
  TaskPatch,
} from '@agency-crm/shared';
import { apiRequest } from '@/lib/api';

const seg = encodeURIComponent;

export const workKeys = {
  comms: (clientId: string, page: number) => ['communications', clientId, page] as const,
  tasks: (q: TaskListQuery) => ['tasks', 'list', q] as const,
  task: (id: string) => ['tasks', 'detail', id] as const,
};

export interface Page<T> {
  rows: T[];
  total: number;
}

const toQueryString = (q: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '' && v !== null && v !== false) params.set(k, String(v));
  }
  return params.toString();
};

export const COMMS_PAGE_SIZE = 10;

export function useCommunications(clientId: string, page: number) {
  return useQuery({
    queryKey: workKeys.comms(clientId, page),
    queryFn: async (): Promise<Page<CommunicationDto>> => {
      const res = await apiRequest<CommunicationDto[]>(
        'GET',
        `/clients/${seg(clientId)}/communications?page=${page}&pageSize=${COMMS_PAGE_SIZE}`,
      );
      return { rows: res.data, total: Number((res.meta as { total?: number }).total ?? 0) };
    },
    placeholderData: keepPreviousData,
  });
}

export function useTasks(q: TaskListQuery) {
  return useQuery({
    queryKey: workKeys.tasks(q),
    queryFn: async (): Promise<Page<TaskDto>> => {
      const res = await apiRequest<TaskDto[]>('GET', `/tasks?${toQueryString(q)}`);
      return { rows: res.data, total: Number((res.meta as { total?: number }).total ?? 0) };
    },
    placeholderData: keepPreviousData,
  });
}

/** Communications show their follow-up tasks, so both caches refresh after any change. */
function useRefreshWork() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['communications'] }),
      qc.invalidateQueries({ queryKey: ['tasks'] }),
    ]);
}

export function useSaveCommunication(clientId: string) {
  const refresh = useRefreshWork();
  return useMutation({
    mutationFn: (v: { id?: string; input: CommunicationInput }) =>
      v.id
        ? apiRequest<CommunicationDto>('PATCH', `/communications/${seg(v.id)}`, v.input)
        : apiRequest<CommunicationDto>('POST', `/clients/${seg(clientId)}/communications`, v.input),
    onSuccess: refresh,
  });
}

export function useSaveTask() {
  const refresh = useRefreshWork();
  return useMutation({
    mutationFn: (v: { id: string; patch: TaskPatch } | { input: TaskInput }) =>
      'patch' in v
        ? apiRequest<TaskDto>('PATCH', `/tasks/${seg(v.id)}`, v.patch)
        : apiRequest<TaskDto>('POST', '/tasks', v.input),
    onSuccess: refresh,
  });
}
