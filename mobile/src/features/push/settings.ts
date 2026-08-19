import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'reelive.benachrichtigungen';

// If the entry is missing (first install, cleared storage, read error), ON
// applies: push registration has run automatically on every signedIn since
// Task 4, the switch in the profile tab must not silence existing
// installations. That's why '0' is the only OFF value — the mirror image
// of moments/settings, where '1' is the only ON value, because the
// default there is off.
export async function notificationsActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function setNotificationsActive(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // An unsaved switch is unpleasant, but no reason to crash the profile
    // tab; the next call uses the last actually saved value again (or the
    // default).
  }
}
