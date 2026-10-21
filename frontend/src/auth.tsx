// Signed-in user state. The session cookie is HttpOnly, so the client only ever asks the server
// who it is (GET /v2/me); it never sees or stores the token.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import { Spinner } from './components/ui';

export interface Me { user: { user_id: string; username: string; role: string; created_at: string }; locale: string; profile: Record<string, unknown>; session_count: number }

interface AuthState { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthState>({ me: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('GET', '/me'));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.warn(e);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api('POST', '/auth/logout', {}).catch(() => {});
    setMe(null);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8"><Spinner /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}
