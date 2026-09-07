import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createIdempotencyKey, getInstallationToken } from './installation';

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getRandomBytesAsync = jest.mocked(Crypto.getRandomBytesAsync);
const getItemAsync = jest.mocked(SecureStore.getItemAsync);
const setItemAsync = jest.mocked(SecureStore.setItemAsync);
const originalPlatform = Platform.OS;

describe('getInstallationToken', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });
  });

  it('creates and securely stores a 256-bit lowercase hexadecimal credential', async () => {
    getItemAsync.mockResolvedValue(null);
    getRandomBytesAsync.mockResolvedValue(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    );
    setItemAsync.mockResolvedValue();

    const token = await getInstallationToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(
      '000102030405060708090a0b0c0d0e0f' +
        '101112131415161718191a1b1c1d1e1f',
    );
    expect(setItemAsync).toHaveBeenCalledWith(
      'context_reader_installation_token_v1',
      token,
    );
  });

  it('shares one credential creation across concurrent first calls', async () => {
    getItemAsync.mockResolvedValue(null);
    getRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(171));
    setItemAsync.mockResolvedValue();

    const [first, second] = await Promise.all([
      getInstallationToken(),
      getInstallationToken(),
    ]);

    expect(first).toBe(second);
    expect(getRandomBytesAsync).toHaveBeenCalledTimes(1);
    expect(setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('reuses the credential already stored on the device', async () => {
    const storedToken = '7f'.repeat(32);
    getItemAsync.mockResolvedValue(storedToken);

    await expect(getInstallationToken()).resolves.toBe(storedToken);
    expect(getRandomBytesAsync).not.toHaveBeenCalled();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('requires native secure storage on Web without touching storage', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });

    await expect(getInstallationToken()).rejects.toMatchObject({
      code: 'NATIVE_AUTH_REQUIRED',
    });
    expect(getItemAsync).not.toHaveBeenCalled();
    expect(getRandomBytesAsync).not.toHaveBeenCalled();
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});

describe('createIdempotencyKey', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('creates a 128-bit lowercase hexadecimal operation key', async () => {
    getRandomBytesAsync.mockResolvedValue(
      Uint8Array.from({ length: 16 }, (_, index) => 255 - index),
    );

    await expect(createIdempotencyKey()).resolves.toMatch(/^[0-9a-f]{32}$/);
    expect(getRandomBytesAsync).toHaveBeenCalledWith(16);
  });
});
