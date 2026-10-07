import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionExpired } from './api.js';

const SessionContext = createContext(null);

export const SESSION_EXPIRED_NOTICE = 'Your session has expired. Please log in again.';
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Client view of the server-side session. The server is the source of truth:
 * this only mirrors GET /api/auth/session and never stores credentials.
 */
export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, expiresAt: null, notice: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/session');
      setState((prev) => ({
        status: data.authenticated ? 'authenticated' : 'anonymous',
        user: data.user ?? null,
        expiresAt: data.session?.expiresAt ?? null,
        error: null,
        notice:
          !data.authenticated && (data.reason === 'expired' || prev.status === 'authenticated')
            ? SESSION_EXPIRED_NOTICE
            : prev.notice,
      }));
    } catch (error) {
      setState((prev) => (prev.status === 'loading' ? { ...prev, status: 'error', error } : prev));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onSessionExpired(() =>
        setState({ status: 'anonymous', user: null, expiresAt: null, notice: SESSION_EXPIRED_NOTICE, error: null }),
      ),
    [],
  );

  // Re-check when the tab regains focus and when the session is due to expire.
  useEffect(() => {
    if (state.status !== 'authenticated') return undefined;
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    let timer;
    if (state.expiresAt) {
      const delay = Math.min(MAX_TIMEOUT, Math.max(0, new Date(state.expiresAt).getTime() - Date.now() + 1000));
      timer = setTimeout(refresh, delay);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, [state.status, state.expiresAt, refresh]);

  const signIn = useCallback(({ user, session }) => {
    setState({ status: 'authenticated', user, expiresAt: session?.expiresAt ?? null, notice: null, error: null });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setState({ status: 'anonymous', user: null, expiresAt: null, notice: null, error: null });
    }
  }, []);

  const clearNotice = useCallback(() => setState((prev) => (prev.notice ? { ...prev, notice: null } : prev)), []);

  const value = useMemo(
    () => ({ ...state, refresh, signIn, signOut, clearNotice }),
    [state, refresh, signIn, signOut, clearNotice],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
