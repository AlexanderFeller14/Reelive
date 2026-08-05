import { createClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secureSessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase-Konfiguration fehlt: EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env setzen (Vorlage: .env.example, Werte aus `supabase status`).'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
