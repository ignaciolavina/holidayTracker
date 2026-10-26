import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@ht/shared';
import { api, ApiError } from './api';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  setUser: (u: Me) => void;
  refetch: () => Promise<unknown>;
}
const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const setUser = useCallback((u: Me) => qc.setQueryData(['me'], u), [qc]);
  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ user: Me }>('/auth/login', { email, password });
      qc.clear();
      qc.setQueryData(['me'], res.user);
      return res.user;
    },
    [qc],
  );
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.clear();
      qc.setQueryData(['me'], null);
    }
  }, [qc]);
  const value = useMemo<AuthState>(
    () => ({ user: q.data ?? null, loading: q.isLoading, login, logout, setUser, refetch: q.refetch }),
    [q.data, q.isLoading, q.refetch, login, logout, setUser],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
