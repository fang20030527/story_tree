export class WechatLoginUnavailableError extends Error {
  readonly code = 'WECHAT_CLIENT_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'WechatLoginUnavailableError';
  }
}
