import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
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

async function hasProfile(userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  return data !== null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const evaluate = useCallback(async (s: Session | null) => {
    if (!s) return setStatus('signedOut');
    setStatus((await hasProfile(s.user.id)) ? 'signedIn' : 'needsProfile');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void evaluate(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void evaluate(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  return (
    <AuthContext.Provider
      value={{
        status,
        userId: session?.user.id ?? null,
        refreshProfile: () => evaluate(session),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
