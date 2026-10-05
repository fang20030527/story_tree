import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: jest.fn(), setItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn(async () => new Uint8Array(16).fill(171)) }));

const originalOS = Platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function freshModule(): typeof import('./deviceId') {
  let loaded!: typeof import('./deviceId');
  jest.isolateModules(() => { loaded = jest.requireActual('./deviceId'); });
  return loaded;
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  jest.clearAllMocks();
});

it('keeps one ID per browser in localStorage, shared by every tab', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const values = new Map<string, string>();
  const localStorage = { getItem: jest.fn((key: string) => values.get(key) ?? null), setItem: jest.fn((key: string, value: string) => values.set(key, value)) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  const first = await freshModule().getDeviceId();
  expect(first).toBe('ab'.repeat(16));
  // A new tab loads the module again and finds the same ID.
  expect(await freshModule().getDeviceId()).toBe(first);
  expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('keeps the native ID in the Keychain for this device only, apart from sign-in credentials', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
  const id = await freshModule().getDeviceId();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('context_reader_device_id_v1', id,
    { keychainAccessible: 'after-first-unlock-this-device-only' });
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(id);
  expect(await freshModule().getDeviceId()).toBe(id);
});

it('sends no ID when the device cannot store one', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  expect(await freshModule().getDeviceId()).toBeNull();
});
