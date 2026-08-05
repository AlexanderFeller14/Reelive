export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'signedIn';

// Reine Routing-Entscheidung — getrennt gehalten, damit sie ohne
// React/Supabase testbar ist. null = noch nicht umleiten (Splash steht).
export function resolveRoute(status: AuthStatus): '/welcome' | '/profile-setup' | '/aufnehmen' | null {
  switch (status) {
    case 'loading': return null;
    case 'signedOut': return '/welcome';
    case 'needsProfile': return '/profile-setup';
    case 'signedIn': return '/aufnehmen';
  }
}
