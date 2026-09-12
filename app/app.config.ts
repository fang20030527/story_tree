import type { ExpoConfig } from 'expo/config';

import appJson from './app.json';

const baseConfig = appJson.expo as ExpoConfig;

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function associatedDomain(universalLink: string | undefined): string | undefined {
  if (!universalLink) return undefined;
  try {
    const url = new URL(universalLink);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error('invalid universal link');
    }
    return `applinks:${url.hostname}`;
  } catch {
    throw new Error(
      'EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK must be a valid https:// URL',
    );
  }
}

export default function appConfig(): ExpoConfig {
  const appId = readOptional('EXPO_PUBLIC_WECHAT_APP_ID');
  const universalLink = readOptional('EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK');
  const domain = associatedDomain(universalLink);
  const iosBundleIdentifier =
    readOptional('EXPO_PUBLIC_IOS_BUNDLE_ID') ?? 'com.contextreader.waikan';
  const androidPackage =
    readOptional('EXPO_PUBLIC_ANDROID_PACKAGE') ?? 'com.contextreader.waikan';

  return {
    ...baseConfig,
    scheme: appId ? ['app', appId] : baseConfig.scheme,
    ios: {
      ...baseConfig.ios,
      bundleIdentifier: iosBundleIdentifier,
      ...(domain ? { associatedDomains: [domain] } : {}),
    },
    android: {
      ...baseConfig.android,
      package: androidPackage,
    },
    ...(appId
      ? { plugins: [...(baseConfig.plugins ?? []), 'expo-native-wechat'] }
      : {}),
  };
}
