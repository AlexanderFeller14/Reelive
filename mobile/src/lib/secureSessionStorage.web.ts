// Web-Fassung von secureSessionStorage.ts (Task-4-Brief, Phase 6).
//
// Speichert NICHTS und liest NICHTS. Das ist kein Zwischenstand, der später
// "vervollständigt" werden muss, es ist die vollständige, gewollte
// Implementierung, aus zwei Gründen:
//
// 1. Spec-Versprechen W5: "Wer kein Konto hat, kommt an nichts anderes."
//    Der Web-Player zeigt öffentliche Recaps ausschliesslich über einen
//    widerrufbaren Link (share-link/aufloesen, Edge Function mit eigener
//    Prüfkette), er braucht dafür nie eine angemeldete Supabase-Sitzung.
//    Es gibt im Browser also nichts, was legitim aufbewahrt werden müsste.
// 2. Selbst wenn es das gäbe: Im Browser fehlt die sichere Ablage, auf der
//    die native Fassung aufbaut (Secure Enclave/Keystore hinter
//    expo-secure-store). Jede Web-Alternative (localStorage, IndexedDB, ein
//    eigenes AsyncStorage-Web) liegt für jedes Skript auf der Seite offen,
//    ein XSS-Bug würde die Sitzung direkt auslesbar machen. Es gibt keine
//    Web-Fassung, die dasselbe Sicherheitsversprechen wie SecureStore
//    einlöst; darum wird hier keine gebaut.
//
// supabase.ts reicht dieses Objekt als `auth.storage` an createClient()
// weiter: nach jedem setItem() findet das nächste getItem() nichts wieder,
// also entsteht auf Web nie eine über den Seitenaufruf hinaus bestehende
// Sitzung. `detectSessionInUrl: false` (siehe supabase.ts) verhindert
// zusätzlich, dass GoTrue Tokens aus dem URL-Fragment übernimmt, sonst
// bliebe ein zweiter, an dieser Datei vorbeiführender Weg zu einer Sitzung
// offen. Wer das "reparieren" will, verletzt W5.
export const secureSessionStorage = {
  async getItem(_key: string): Promise<string | null> {
    return null;
  },
  async setItem(_key: string, _value: string): Promise<void> {},
  async removeItem(_key: string): Promise<void> {},
};
