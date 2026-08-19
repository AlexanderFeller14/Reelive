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

// Token refresh only in the foreground (official Supabase RN pattern)
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// null = query failed (RLS/network), deliberately kept separate from "no
// profile" so evaluate() never misinterprets an error as needsProfile.
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
      // found === false: query succeeded, no profile => needsProfile.
      // found === true OR null (query error): signedIn, on an error the user
      // stays signed in instead of falsely landing in profile setup;
      // profile-dependent UI degrades until the next evaluate() round.
      setStatus(found === false ? 'needsProfile' : 'signedIn');
    } catch {
      // An unexpected reject (e.g. a network exception instead of an
      // {error} return) must never leave the status stuck on "loading"
      // permanently.
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
        // getSession() itself can reject (e.g. a storage error), without a
        // fallback the status would stay on "loading" forever (endless
        // splash).
        setStatus('signedOut');
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void evaluate(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  // Without useMemo, EVERY render of this provider creates a new context
  // object, and React then wakes every consumer, here practically every
  // screen of the app, since the provider sits at the root. The values it
  // holds change rarely by comparison.
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      userId: session?.user.id ?? null,
      refreshProfile: () => evaluate(session),
    }),
    [status, session, evaluate]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
