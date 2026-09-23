import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from './api';
import { fetchSession, SessionContext, type SessionState } from './session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  const refresh = useCallback(async () => {
    setState(await fetchSession());
  }, []);

  const signOut = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setState({ status: 'anonymous', user: null });
  }, []);

  useEffect(() => {
    // Le drapeau evite d'ecrire dans un composant demonte, par exemple si la
    // page change pendant que la reponse arrive.
    let abandonne = false;

    void (async () => {
      const next = await fetchSession();
      if (!abandonne) setState(next);
    })();

    return () => {
      abandonne = true;
    };
  }, []);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);

  return <SessionContext value={value}>{children}</SessionContext>;
}
