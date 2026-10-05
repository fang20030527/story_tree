import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * A random ID for this device, sent as X-Device-Id so the server shares one daily free practice
 * allowance between every account used here. It is not a credential and is never cleared on
 * sign-out: on iOS the Keychain keeps it across reinstalls, and in a browser localStorage keeps
 * it across tabs (sign-in itself stays per tab in sessionStorage). The server stores only a hash.
 */
const DEVICE_ID_KEY = 'context_reader_device_id_v1';
const DEVICE_ID = /^[a-f0-9]{32}$/u;
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let pending: Promise<string | null> | null = null;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

async function loadOrCreate(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const storage = browserStorage();
    if (!storage) return null;
    const stored = storage.getItem(DEVICE_ID_KEY);
    if (stored && DEVICE_ID.test(stored)) return stored;
    const created = hex(await Crypto.getRandomBytesAsync(16));
    storage.setItem(DEVICE_ID_KEY, created);
    return created;
  }
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY, KEYCHAIN);
  if (stored && DEVICE_ID.test(stored)) return stored;
  const created = hex(await Crypto.getRandomBytesAsync(16));
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created, KEYCHAIN);
  return created;
}

/** Null when the device cannot keep one (blocked storage); requests then go without it. */
export function getDeviceId(): Promise<string | null> {
  pending ??= loadOrCreate().catch(() => {
    pending = null;
    return null;
  });
  return pending;
}
