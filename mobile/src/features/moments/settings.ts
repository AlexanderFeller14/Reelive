import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'reelive.nurWlan';

// If the entry is missing (first install or cleared storage), "false" applies,
// uploads also run over mobile data until someone explicitly turns on
// WiFi-only (Task-6-Interface: default false).
export async function wifiOnly(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setWifiOnly(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // An unsaved switch is annoying but no reason to crash the settings
    // screen; the next call falls back to the last actually saved value
    // (or the default).
  }
}
