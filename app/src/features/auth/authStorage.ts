import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  RegisteredAuthResponseSchema,
  type RegisteredAuthResponse,
} from '@context-reader/contracts';

import { AUTH_USER_KEY } from '@/api/storage';

export async function saveAuthUser(user: RegisteredAuthResponse): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(AUTH_USER_KEY, JSON.stringify(user));
}

export async function loadAuthUser(): Promise<RegisteredAuthResponse | null> {
  if (Platform.OS === 'web') return null;
  const stored = await SecureStore.getItemAsync(AUTH_USER_KEY);
  if (!stored) return null;
  try {
    const parsed = RegisteredAuthResponseSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
