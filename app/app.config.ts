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
  if (process.env.EAS_BUILD_PROFILE === 'production') {
    const value = readOptional('EXPO_PUBLIC_API_BASE_URL');
    let origin: URL | undefined;
    try {
      origin = value ? new URL(value) : undefined;
    } catch { /* 配置错误只报告变量名。 */ }
    if (!origin || origin.protocol !== 'https:' || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash ||
        !origin.hostname.includes('.') || origin.hostname.endsWith('.localhost') ||
        origin.hostname.endsWith('.local') || origin.hostname.endsWith('.lan') ||
        /^\d+(?:\.\d+){3}$/u.test(origin.hostname)) {
      throw new Error('生产构建需要 EXPO_PUBLIC_API_BASE_URL 使用公开 HTTPS 域名');
    }
  }
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
