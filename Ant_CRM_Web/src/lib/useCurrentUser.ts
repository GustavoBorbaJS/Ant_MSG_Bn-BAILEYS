import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { CurrentUser } from './api';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: async () => (await api.get<CurrentUser>('/auth/me')).data,
    staleTime: 60_000,
  });
}
