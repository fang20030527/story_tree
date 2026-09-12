import { WechatLoginUnavailableError } from './wechat-common';

export { WechatLoginUnavailableError };

export async function requestWechatCode(): Promise<string> {
  throw new WechatLoginUnavailableError('微信登录需要 iOS 或 Android 原生构建');
}
