import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthStatus } from './guard';

type AuthContextValue = {
  status: AuthStatus;
  userId: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  userId: null,
  refreshProfile: async () => {},
});

// Token-Refresh nur im Vordergrund (offizielles Supabase-RN-Muster)
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// null = Query fehlgeschlagen (RLS/Netzwerk) — bewusst getrennt von "kein Profil",
// damit evaluate() einen Fehler nie fälschlich als needsProfile interpretiert.
async function hasProfile(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) return null;
  return data !== null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const evaluate = useCallback(async (s: Session | null) => {
    try {
      if (!s) return setStatus('signedOut');
      const found = await hasProfile(s.user.id);
      // found === false: Query erfolgreich, kein Profil ⇒ needsProfile.
      // found === true ODER null (Query-Fehler): signedIn — bei einem Fehler
      // bleibt der Nutzer angemeldet statt fälschlich ins Profil-Setup zu
      // geraten; profilabhängige UI degradiert bis zur nächsten evaluate()-Runde.
      setStatus(found === false ? 'needsProfile' : 'signedIn');
    } catch {
      // Unerwarteter Reject (z.B. Netzwerk-Exception statt {error}-Rückgabe)
      // darf den Status nie dauerhaft auf "loading" stehen lassen.
      setStatus(s ? 'signedIn' : 'signedOut');
    }
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        void evaluate(data.session);
      })
      .catch(() => {
        // getSession() selbst kann rejecten (z.B. Storage-Fehler) — ohne
        // Fallback bliebe der Status für immer auf "loading" (endloser Splash).
        setStatus('signedOut');
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void evaluate(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  // Ohne useMemo entsteht bei JEDEM Render dieses Providers ein neues
  // Context-Objekt, und React weckt daraufhin jeden Consumer — hier also
  // praktisch jeden Screen der App, denn der Provider sitzt an der Wurzel.
  // Die enthaltenen Werte aendern sich dagegen selten.
  const wert = useMemo<AuthContextValue>(
    () => ({
      status,
      userId: session?.user.id ?? null,
      refreshProfile: () => evaluate(session),
    }),
    [status, session, evaluate]
  );

  return <AuthContext.Provider value={wert}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
