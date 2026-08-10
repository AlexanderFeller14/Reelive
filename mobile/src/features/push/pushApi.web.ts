export type PushRegistrierungsErgebnis = 'ok' | 'keine-berechtigung' | 'nicht-unterstuetzt' | 'fehler';

// Web-Fassung von pushApi.ts (Task-4-Brief, Phase 6).
//
// Kein Import von expo-notifications oder expo-device: beide ziehen native
// Module, die Metro auf Web nicht bündeln kann bzw. deren Push-Funktionen im
// Browser ohnehin nicht existieren. Die native Fassung würde für
// Platform.OS === 'web' sofort 'nicht-unterstuetzt' liefern, noch bevor sie
// eine der beiden Bibliotheken tatsächlich benutzt, dieser Web-Shim macht
// diesen Kurzschluss nur explizit und vermeidet dabei den Import selbst.
//
// Wirft nie, wie im Brief für die native Fassung verlangt (jeder
// Fehlschlag ist hier erst recht ein Normalfall, kein Fehler): das
// Root-Layout ruft registrierePushToken() bei jedem signedIn-Wechsel ohne
// Fehlerbehandlung auf.
export async function registrierePushToken(_userId: string): Promise<PushRegistrierungsErgebnis> {
  return 'nicht-unterstuetzt';
}

export async function deregistrierePushToken(): Promise<void> {}
