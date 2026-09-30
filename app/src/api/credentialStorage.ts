import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// 浏览器只在当前标签页会话保存凭据，不写入长期 localStorage。
function browserStorage(): Storage {
  try { if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage; } catch { /* 隐私模式可能禁止访问存储。 */ }
  throw new Error('当前浏览器无法安全保存登录会话');
}

export async function getCredential(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? browserStorage().getItem(key) : SecureStore.getItemAsync(key);
}
export async function setCredential(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') browserStorage().setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}
export async function deleteCredential(key: string): Promise<void> {
  if (Platform.OS === 'web') browserStorage().removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}
