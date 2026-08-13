import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'reelive.benachrichtigungen';

// Fehlt der Eintrag (Erstinstallation, geleerter Speicher, Lesefehler), gilt
// AN: die Push-Registrierung lief seit Task 4 bei jedem signedIn automatisch,
// der Schalter im Profil-Tab darf bestehende Installationen nicht
// stummschalten. Deshalb ist '0' der einzige Aus-Wert — das Spiegelbild von
// moments/einstellungen, wo '1' der einzige An-Wert ist, weil dort der
// Default aus ist.
export async function benachrichtigungenAktiv(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function setzeBenachrichtigungen(wert: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, wert ? '1' : '0');
  } catch {
    // Ein nicht gespeicherter Schalter ist unangenehm, aber kein Grund, den
    // Profil-Tab abstürzen zu lassen; beim nächsten Aufruf gilt wieder der
    // zuletzt tatsächlich gespeicherte Wert (bzw. der Standard).
  }
}
