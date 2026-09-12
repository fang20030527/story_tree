import { describe, expect, it, vi } from 'vitest';

import { WechatOAuthClient, type WechatClientConfig } from './wechat-client';

const config: WechatClientConfig = {
  appId: 'wx-test-app',
  appSecret: 'server-only-secret',
  baseUrl: 'https://api.example.invalid/',
  timeoutMs: 20,
};

describe('WeChat OAuth client', () => {
  it('exchanges a code and returns only stable provider identity fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'provider-token',
        expires_in: 7_200,
        openid: 'open-id-1',
        unionid: 'union-id-1',
        scope: 'snsapi_userinfo',
      }),
    );
    const client = new WechatOAuthClient(config, fetchImpl);

    await expect(client.exchangeCode('short-lived-code')).resolves.toEqual({
      openid: 'open-id-1',
      unionid: 'union-id-1',
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://api.example.invalid/sns/oauth2/access_token?appid=wx-test-app&secret=server-only-secret&code=short-lived-code&grant_type=authorization_code',
    );
    expect(init).toMatchObject({ method: 'GET' });
  });

  it('maps provider errors and malformed responses without exposing credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ errcode: 40029, errmsg: 'invalid code' }),
    );
    const client = new WechatOAuthClient(config, fetchImpl);
    const error = await capture(client.exchangeCode('bad-code'));

    expect(error).toMatchObject({ code: 'WECHAT_AUTH_FAILED', statusCode: 401 });
    expect(`${error.message}\n${error.stack ?? ''}`).not.toContain(
      config.appSecret,
    );
    expect(`${error.message}\n${error.stack ?? ''}`).not.toContain('bad-code');
  });

  it('rejects requests when server credentials are absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new WechatOAuthClient(
      { ...config, appId: '', appSecret: '' },
      fetchImpl,
    );

    await expect(client.exchangeCode('code')).rejects.toMatchObject({
      code: 'WECHAT_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('distinguishes malformed provider data from an unavailable provider', async () => {
    const malformed = new WechatOAuthClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ openid: 42 })),
    );
    await expect(malformed.exchangeCode('code')).rejects.toMatchObject({
      code: 'WECHAT_AUTH_FAILED',
      statusCode: 401,
      retryable: false,
    });

    const unavailable = new WechatOAuthClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: 'upstream unavailable' }, 503),
      ),
    );
    await expect(unavailable.exchangeCode('code')).rejects.toMatchObject({
      code: 'WECHAT_AUTH_FAILED',
      statusCode: 502,
      retryable: true,
    });
  });

  it('maps timeouts to a retryable provider error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error('missing abort signal'));
            return;
          }
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const client = new WechatOAuthClient({ ...config, timeoutMs: 5 }, fetchImpl);

    await expect(client.exchangeCode('code')).rejects.toMatchObject({
      code: 'WECHAT_AUTH_FAILED',
      retryable: true,
      statusCode: 502,
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function capture(promise: Promise<unknown>): Promise<Error & Record<string, unknown>> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
}
