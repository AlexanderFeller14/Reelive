// Web version of secureSessionStorage.ts (task 4 brief, phase 6).
//
// It retains nothing, and that is the complete, intended implementation, not an
// intermediate state waiting to be "finished". Proof and exact behaviour live in
// lib/__tests__/secureSessionStorage.web.test.ts, above all "no second storage
// path: neither expo-secure-store nor AsyncStorage is ever touched".
//
// Two reasons:
//
// 1. Spec promise W5: "Whoever has no account gets at nothing else."
//    The web player shows public recaps exclusively through a revocable link
//    (share-link/resolve, an edge function with its own check chain), it never
//    needs a signed-in Supabase session for that. So there is nothing in the
//    browser that would legitimately have to be kept.
// 2. Even if there were: the browser lacks the secure store the native version
//    builds on (Secure Enclave/Keystore behind expo-secure-store). Every web
//    alternative (localStorage, IndexedDB, a home-grown AsyncStorage for web)
//    lies open to every script on the page, and an XSS bug would make the
//    session directly readable. There is no web version that keeps the same
//    security promise as SecureStore; that is why none is built here.
//
// supabase.ts hands this object to createClient() as `auth.storage`, so no
// session outliving the page view can ever come about on web.
// `detectSessionInUrl: false` (see supabase.ts) additionally keeps GoTrue from
// picking up tokens out of the URL fragment, otherwise a second route to a
// session, bypassing this file, would stay open. Whoever "repairs" this
// violates W5.
export const secureSessionStorage = {
  async getItem(_key: string): Promise<string | null> {
    return null;
  },
  async setItem(_key: string, _value: string): Promise<void> {},
  async removeItem(_key: string): Promise<void> {},
};
