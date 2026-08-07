import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'reelive.nurWlan';

// Fehlt der Eintrag (Erstinstallation oder geleerter Speicher), gilt "false" —
// Uploads laufen auch über Mobilfunk, bis jemand WLAN-only ausdrücklich einschaltet
// (Task-6-Interface: Standard false).
export async function nurUeberWlan(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setzeNurUeberWlan(wert: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, wert ? '1' : '0');
  } catch {
    // Ein nicht gespeicherter Schalter ist unangenehm, aber kein Grund, den
    // Einstellungen-Screen abstürzen zu lassen — beim nächsten Aufruf gilt
    // wieder der zuletzt tatsächlich gespeicherte Wert (bzw. der Standard).
  }
}
