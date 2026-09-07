import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { INSTALLATION_TOKEN_KEY } from './storage';

let inFlightToken: Promise<string> | null = null;

export class InstallationCredentialUnavailableError extends Error {
  readonly code = 'NATIVE_AUTH_REQUIRED';

  constructor() {
    super('云端练习需要 iOS 或 Android 的安全凭据存储');
    this.name = 'InstallationCredentialUnavailableError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function loadOrCreateInstallationToken(): Promise<string> {
  const storedToken = await SecureStore.getItemAsync(INSTALLATION_TOKEN_KEY);
  if (storedToken) return storedToken;

  const token = bytesToHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(INSTALLATION_TOKEN_KEY, token);
  return token;
}

export async function getInstallationToken(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new InstallationCredentialUnavailableError();
  }

  if (!inFlightToken) {
    inFlightToken = loadOrCreateInstallationToken().finally(() => {
      inFlightToken = null;
    });
  }

  return inFlightToken;
}

export async function createIdempotencyKey(): Promise<string> {
  return bytesToHex(await Crypto.getRandomBytesAsync(16));
}
