import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type PushRegistrierungsErgebnis = 'ok' | 'keine-berechtigung' | 'nicht-unterstuetzt' | 'fehler';

// ----------------------------------------------------------------------------
// Jeder Fehlschlag hier ist ein NORMALFALL, kein Fehler (Task-4-Brief): keine
// Berechtigung, Simulator, Web, Expo Go. Die App wird bislang ausschliesslich
// in Expo Go entwickelt, laut Expo-Doku kann Expo Go seit SDK 53 GAR KEINE
// Remote-Pushes mehr empfangen ("You must use a development build to use push
// notifications since the capability is not built into Expo Go"). Dieser Pfad
// ist also der ALLTAG, nicht die Ausnahme. Die Funktion darf deshalb NIE
// werfen und der Person NIE etwas anzeigen, sie gibt nur den passenden Wert
// zurück. Das try/catch um den gesamten Ablauf ist damit kein Sicherheitsnetz
// für Randfälle, sondern trägt den Regelfall.
//
// Konkret beobachtetes Verhalten von expo-notifications in Expo Go (Quelle:
// node_modules/expo-notifications/build/warnOfExpoGoPushUsage.js):
// - Der blosse Import von `expo-notifications` warnt/wirft NICHT. Das native
//   Modul für Berechtigungen ist in Expo Go weiterhin eingebaut; nur der
//   Zugriff auf den PUSH-TOKEN ist betroffen (siehe unten). getPermissionsAsync
//   und requestPermissionsAsync laufen in Expo Go normal durch.
// - Erst beim Token-Abruf (Notifications.getExpoPushTokenAsync, ruft intern
//   getDevicePushTokenAsync auf) greift die Expo-Go-Sperre: auf ANDROID wirft
//   sie synchron eine Error, auf iOS nur ein console.warn, dort scheitert der
//   Abruf danach ohnehin am fehlenden EAS-Projekt (kein eas.json in diesem
//   Repo → ERR_NOTIFICATIONS_NO_EXPERIENCE_ID) oder am fehlenden nativen
//   Push-Setup von Expo Go. Beide Enden landen im catch unten und werden zu
//   'fehler', nie zu einem Wurf nach aussen.
// ----------------------------------------------------------------------------
export async function registrierePushToken(userId: string): Promise<PushRegistrierungsErgebnis> {
  try {
    // push_tokens.platform erlaubt per CHECK-Constraint nur 'ios'|'android'
    // (Migration 20260808090000_push_tokens.sql). Web oder künftige
    // Plattformen sind "nicht unterstützt", kein Fehler.
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'nicht-unterstuetzt';

    // Simulator/Emulator bekommt nie einen echten Push-Token, expo-device
    // ist dafür da (Brief Step 2).
    if (!Device.isDevice) return 'nicht-unterstuetzt';

    // Android 13+ (laut versionsgenauer SDK-57-Doku, s. AGENTS.md): Der
    // System-Berechtigungsdialog erscheint erst, NACHDEM mindestens ein
    // Notification-Channel existiert, ohne diesen Aufruf bliebe
    // requestPermissionsAsync() unten wirkungslos (kein Dialog, Status bleibt
    // 'undetermined'), was aber ohnehin sauber in 'keine-berechtigung'
    // mündet. Auf iOS/Web ist der Aufruf ein dokumentierter No-Op
    // (console.debug + null), auf Android best-effort: schlägt er fehl (z.B.
    // Expo Go), macht das den Rest des Ablaufs nicht kaputt, er läuft
    // einfach in dieselbe 'keine-berechtigung'/'fehler'-Bahn wie ohne Channel.
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Reelive',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch {
        // Best effort, siehe Kommentar oben.
      }
    }

    let berechtigung = await Notifications.getPermissionsAsync();
    if (berechtigung.status !== 'granted') {
      // Nur erfragen, wenn noch nicht entschieden bzw. abgelehnt, die
      // native Anfrage selbst zeigt der Person den System-Dialog, das ist
      // hier korrekt (kein eigener Dialog davor, DESIGN-LANGUAGE verlangt
      // keinen).
      berechtigung = await Notifications.requestPermissionsAsync();
    }
    if (berechtigung.status !== 'granted') return 'keine-berechtigung';

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return 'fehler';

    const { error } = await supabase.from('push_tokens').upsert(
      {
        token,
        user_id: userId,
        platform: Platform.OS,
        // Ausdrücklich mitsenden: PostgREST baut aus .upsert() ein
        // "on conflict do update set" nur über die GESENDETEN Spalten. Ohne
        // dieses Feld bliebe updated_at beim Wert des Erst-Inserts stehen,
        // obwohl sich dasselbe Gerät danach jahrelang erneut registriert,
        // wer später nach updated_at aufräumt, räumt dann falsch auf
        // (Review aus Task 1).
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );
    if (error) return 'fehler';

    return 'ok';
  } catch {
    return 'fehler';
  }
}

// ----------------------------------------------------------------------------
// Aufgerufen von authApi.signOut() (siehe dort), NICHT über die
// Push-Registrierung selbst, kein Teil des Task-4-Interface-Vertrags, aber
// aus dem Review von Task 1 nötig: ohne das bleibt die Registrierung der
// vorigen Person auf dem Gerät liegen, und der Übernahmepfad des
// SECURITY-DEFINER-Triggers aus Task 1 (push_tokens_take_over) wird zum
// Normalfall statt zur Ausnahme.
//
// Ermittelt bewusst denselben Token erneut, statt einen zuvor registrierten
// Token lokal zwischenzuspeichern, es gibt in dieser App noch keine solche
// Ablage, und ein zweiter Speicherort für denselben Wert wäre eine weitere
// Quelle, die veralten kann. Die Berechtigung wird VORHER geprüft (reines
// Lesen, kein Dialog, keine native Registrierung): ohne 'granted' hat
// registrierePushToken() nie eine Zeile geschrieben, also gibt es nichts zu
// löschen, und getExpoPushTokenAsync() wird erst gar nicht aufgerufen, was
// sonst bei jedem Abmelden eine echte native Push-Registrierung anstiesse,
// selbst für Personen, die nie gefragt wurden. Ist die Berechtigung erteilt,
// liefert getExpoPushTokenAsync() denselben Token ohne erneuten Dialog;
// schlägt der Abruf trotzdem fehl (Expo Go, kein EAS-Projekt, Alltag, siehe
// oben), gibt es ebenfalls nichts zu löschen. Löscht darum NUR die eigene
// Zeile über die RLS-Policy push_tokens_delete_own (user_id = auth.uid());
// andere Geräte derselben Person bleiben registriert.
export async function deregistrierePushToken(): Promise<void> {
  try {
    const berechtigung = await Notifications.getPermissionsAsync();
    if (berechtigung.status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return;
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Nichts zu löschen oder kein Zugriff möglich, beim Abmelden darf das
    // nie den Vorgang aufhalten oder der Person etwas anzeigen.
  }
}
