import { createClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secureSessionStorage';
import { supabaseBasis } from './supabaseAdresse';

// Nicht direkt aus der Umgebung: in der Entwicklung gilt der Rechner, von dem
// das Bundle kam, weil die LAN-IP in der .env veraltet sein kann (siehe dort).
const url = supabaseBasis;
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
