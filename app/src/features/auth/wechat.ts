import { Platform } from 'react-native';

import { WechatLoginUnavailableError } from './wechat-common';

export { WechatLoginUnavailableError } from './wechat-common';

export async function requestWechatCode(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new WechatLoginUnavailableError('微信登录需要 iOS 或 Android 原生构建');
  }

  const appId = process.env.EXPO_PUBLIC_WECHAT_APP_ID?.trim();
  if (!appId) {
    throw new WechatLoginUnavailableError('尚未配置微信 AppID');
  }

  let wechat: typeof import('expo-native-wechat');
  try {
    wechat = await import('expo-native-wechat');
  } catch {
    throw new WechatLoginUnavailableError(
      '当前客户端未包含微信原生模块，请安装开发构建后重试',
    );
  }

  const universalLink = process.env.EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK?.trim();
  try {
    await wechat.registerApp({
      appid: appId,
      ...(universalLink ? { universalLink } : {}),
      log: false,
    });
    if (!(await wechat.isWechatInstalled())) {
      throw new WechatLoginUnavailableError('请先安装微信客户端');
    }

    const state = createState();
    const response = await wechat.sendAuthRequest({
      scope: 'snsapi_userinfo',
      state,
    });
    if (
      response.errorCode !== 0 ||
      response.data.state !== state ||
      !response.data.code
    ) {
      throw new WechatLoginUnavailableError('微信授权未完成，请重试');
    }
    return response.data.code;
  } catch (error) {
    if (error instanceof WechatLoginUnavailableError) throw error;
    throw new WechatLoginUnavailableError('微信客户端暂时不可用，请重试');
  }
}

function createState(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
