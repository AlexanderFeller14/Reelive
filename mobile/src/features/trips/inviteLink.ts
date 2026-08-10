import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

const KEY = 'reelive.pendingInvite';

// createURL liefert in Expo Go exp://host:8081/--/join/<code> und im
// Dev-/Release-Build reelive://join/<code>, derselbe Aufruf, kein Umbau,
// wenn später eine Domain dazukommt.
export function createInviteUrl(code: string): string {
  return Linking.createURL(`/join/${code}`);
}

// Akzeptiert beide Link-Formen. Query-String und Fragment werden abgeschnitten.
export function extractInviteCode(url: string): string | null {
  const match = /\/join\/([^/?#]+)/.exec(url);
  return match ? match[1] : null;
}

// Beim SMS-Login verlässt man die App, um den Code abzulesen. Ein reiner
// Modul-State würde das nicht sicher überleben, deshalb AsyncStorage.
export async function rememberInvite(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // Ein verlorener Invite ist unangenehm, aber kein Grund, den Login zu kippen.
  }
}

// Lesen und Verwerfen sind bewusst getrennt (statt ein atomares "lies und
// lösche"): der Aufrufer verwirft erst, wenn ein Einlöseversuch tatsächlich
// stattgefunden hat, sonst geht ein gemerkter Code verloren, ohne dass je
// beigetreten wurde (siehe joinFlow.ts).
export async function peekRememberedInvite(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function discardRememberedInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Ein hängender Eintrag verhindert höchstens einen erneuten Versuch beim
    // nächsten signedIn, kein Grund, das aufrufende Flow abzubrechen.
  }
}
