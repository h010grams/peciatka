import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@peciatka/shared';
import { api, ApiError } from './api';
import { setLocale } from './i18n';

export const meKey = ['me'] as const;

/** Текущий пользователь; null — не залогинен. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        const me = await api.get<MeResponse>('/auth/me');
        setLocale(me.user.locale);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useCurrentRole() {
  const { data } = useMe();
  return data?.salons.find((s) => s.id === data.currentSalonId)?.role ?? null;
}

/** После логина/регистрации кладём ответ в кеш, чтобы не делать лишний запрос. */
export function useSetMe() {
  const qc = useQueryClient();
  return (me: MeResponse | null) => {
    if (me) setLocale(me.user.locale);
    qc.setQueryData(meKey, me);
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}
