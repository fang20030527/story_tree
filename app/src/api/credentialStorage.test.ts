import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { deleteCredential, getCredential, setCredential } from './credentialStorage';
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const originalOS = Platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  jest.clearAllMocks();
});
it('keeps web credentials in session storage without touching native or long-term storage', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const sessionStorage = { getItem: jest.fn().mockReturnValue('token'), setItem: jest.fn(), removeItem: jest.fn() };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage } });
  await setCredential('key', 'token'); expect(await getCredential('key')).toBe('token'); await deleteCredential('key');
  expect(sessionStorage.setItem).toHaveBeenCalledWith('key', 'token');
  expect(sessionStorage.removeItem).toHaveBeenCalledWith('key');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
it('fails closed if web storage is blocked', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  await expect(setCredential('key', 'token')).rejects.toThrow('当前浏览器无法安全保存登录会话');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
