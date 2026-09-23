import { createContext, use } from 'react';
import { apiFetch } from './api';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  termsVersion: string | null;
  termsAccepted: boolean;
}

/**
 * Trois etats et non deux. « On ne sait pas encore » n'est pas « personne
 * n'est connecte » : les confondre fait clignoter l'ecran de connexion devant
 * quelqu'un qui est deja entre.
 */
export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: CurrentUser };

export interface SessionValue {
  state: SessionState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const value = use(SessionContext);
  if (value === undefined) {
    throw new Error('useSession doit etre appele sous SessionProvider.');
  }
  return value;
}

/** Interroge le serveur et rend l'etat correspondant, sans jamais lever. */
export async function fetchSession(): Promise<SessionState> {
  try {
    const { user } = await apiFetch<{ user: CurrentUser | null }>('/api/auth/me');
    return user === null ? { status: 'anonymous', user: null } : { status: 'authenticated', user };
  } catch {
    // Une API injoignable se lit comme une absence de session : l'ecran de
    // connexion est la bonne destination dans les deux cas.
    return { status: 'anonymous', user: null };
  }
}
