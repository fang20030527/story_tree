import Constants from 'expo-constants';

import { getApiBaseUrl } from './client';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: '192.168.2.204:8081' } },
}));

const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

afterEach(() => {
  if (originalApiBaseUrl === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  }
});

it('uses the current Expo LAN host for a stale local API origin', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.0.138:3000';

  expect(getApiBaseUrl()).toBe('http://192.168.2.204:3000');
});

it('keeps deployed API origins unchanged', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://waikan-api.onrender.com';

  expect(getApiBaseUrl()).toBe('https://waikan-api.onrender.com');
});

it('keeps a local origin when Expo has no runtime host', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:3000';
  jest.mocked(Constants).expoConfig = null;

  expect(getApiBaseUrl()).toBe('http://127.0.0.1:3000');
});
