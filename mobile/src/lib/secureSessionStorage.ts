import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import aesjs from 'aes-js';

// SecureStore holds only ~2 KB, sessions are bigger. Hence: a 256-bit AES key
// per entry in SecureStore, the encrypted payload in AsyncStorage.
async function encrypt(key: string, value: string): Promise<string> {
  const encryptionKey = Crypto.getRandomValues(new Uint8Array(32));
  const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await SecureStore.setItemAsync(sanitize(key), aesjs.utils.hex.fromBytes(encryptionKey));
  return aesjs.utils.hex.fromBytes(encrypted);
}

async function decrypt(key: string, hexValue: string): Promise<string | null> {
  const keyHex = await SecureStore.getItemAsync(sanitize(key));
  if (!keyHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(hexValue)));
}

// SecureStore allows only [A-Za-z0-9._-]
const sanitize = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    try {
      return await decrypt(key, stored);
    } catch {
      // Ciphertext and SecureStore key can drift apart (e.g. an aborted write),
      // utf8.fromBytes then throws at byte level. Treat that as "no entry"
      // instead of letting the app crash: Supabase sees no session and the
      // person signs in again cleanly.
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(sanitize(key));
  },
};
