import { z } from 'zod';

import { AppError } from '../../core/errors';

const WechatTokenResponseSchema = z
  .object({
    access_token: z.string().optional(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    openid: z.string().optional(),
    scope: z.string().optional(),
    unionid: z.string().optional(),
    errcode: z.number().optional(),
    errmsg: z.string().optional(),
  })
  .passthrough();

export interface WechatClientConfig {
  appId: string;
  appSecret: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface WechatIdentity {
  openid: string;
  unionid?: string;
}

export interface WechatClient {
  exchangeCode(code: string, signal?: AbortSignal): Promise<WechatIdentity>;
}

export class WechatOAuthClient implements WechatClient {
  private readonly config: WechatClientConfig;

  constructor(
    config: WechatClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.config = {
      ...config,
      appId: config.appId.trim(),
      appSecret: config.appSecret.trim(),
      baseUrl: config.baseUrl.replace(/\/+$/u, ''),
    };
  }

  async exchangeCode(code: string, signal?: AbortSignal): Promise<WechatIdentity> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new AppError(
        'WECHAT_NOT_CONFIGURED',
        '微信登录尚未配置',
        503,
        false,
      );
    }
    if (!code.trim()) {
      throw new AppError('WECHAT_AUTH_FAILED', '微信授权失败', 401, false);
    }

    const url = new URL(`${this.config.baseUrl}/sns/oauth2/access_token`);
    url.search = new URLSearchParams({
      appid: this.config.appId,
      secret: this.config.appSecret,
      code,
      grant_type: 'authorization_code',
    }).toString();

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: combinedSignal,
      });
    } catch {
      if (signal?.aborted) throw abortedError();
      throw unavailableError(true);
    }

    if (signal?.aborted) throw abortedError();
    if (timeoutSignal.aborted) throw unavailableError(true);
    if (!response.ok) throw unavailableError(response.status >= 500);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw unavailableError(true);
    }

    const parsed = WechatTokenResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.errcode !== undefined) {
      throw new AppError('WECHAT_AUTH_FAILED', '微信授权失败', 401, false);
    }

    const openid = parsed.data.openid?.trim();
    if (!openid) throw unavailableError(true);

    const unionid = parsed.data.unionid?.trim();
    return {
      openid,
      ...(unionid ? { unionid } : {}),
    };
  }
}

function abortedError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function unavailableError(retryable: boolean): AppError {
  return new AppError(
    'WECHAT_AUTH_FAILED',
    '微信登录服务暂时不可用',
    502,
    retryable,
  );
}

export function createWechatClient(config: WechatClientConfig): WechatClient {
  return new WechatOAuthClient(config);
}
