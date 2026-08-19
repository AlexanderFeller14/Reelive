import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

const KEY = 'reelive.pendingInvite';

// createURL yields exp://host:8081/--/join/<code> in Expo Go and
// reelive://join/<code> in the dev/release build, the same call, no rework
// once a domain gets added later.
export function createInviteUrl(code: string): string {
  return Linking.createURL(`/join/${code}`);
}

export function extractInviteCode(url: string): string | null {
  const match = /\/join\/([^/?#]+)/.exec(url);
  return match ? match[1] : null;
}

// The SMS login leaves the app to read the code off. A plain module-level
// state would not reliably survive that, hence AsyncStorage.
export async function rememberInvite(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // A lost invite is unpleasant, but no reason to fail the login.
  }
}

// Reading and discarding are kept deliberately separate (instead of an
// atomic "read and delete"): the caller only discards once a redemption
// attempt has actually happened, otherwise a remembered code would get lost
// without anyone ever having joined (see joinFlow.ts).
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
    // A leftover entry at most prevents a retry on the next signedIn, no
    // reason to fail the calling flow.
  }
}
