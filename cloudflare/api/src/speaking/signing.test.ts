import { Sha256 } from '@smithy/core/checksum';
import { HttpRequest } from '@smithy/core/protocols';
import { SignatureV4 } from '@smithy/signature-v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../env';
import { assertSpeakingObjectKey, signSpeakingObject } from './signing';

const ACCOUNT = 'ABCDEF0123456789ABCDEF0123456789';
const SIGNING_DATE = new Date('2026-10-01T12:34:56.000Z');
const VIDEO = 'speaking/platform/movies/forrest-gump/film.mp4';
const USER_KEY = 'users/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/source';
const env = {
  R2_ACCOUNT_ID: ACCOUNT,
  R2_BUCKET_NAME: 'waikan-2026-audio',
  R2_ACCESS_KEY_ID: 'TESTACCESSKEY',
  R2_SECRET_ACCESS_KEY: 'test-secret-never-published',
} as ApiEnv;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function sdkSignature(method: 'GET' | 'PUT', key: string, headers: Record<string, string> = {}) {
  // 独立用已安装的 AWS 签名实现作离线参考；生产模块完全不导入 SDK。
  const hostname = `${ACCOUNT.toLowerCase()}.r2.cloudflarestorage.com`;
  const sdk = new SignatureV4({
    service: 's3', region: 'auto', sha256: Sha256, uriEscapePath: false,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  return sdk.presign(new HttpRequest({
    hostname, protocol: 'https:', method, path: `/waikan-2026-audio/${key}`,
    headers: { host: hostname, 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD', ...headers },
  }), { signingDate: SIGNING_DATE, expiresIn: 600 });
}

describe('口语私有 R2 签名', () => {
  it('GET 签名与官方 AWS 实现相同，十分钟有效且接受大写账户编号', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SIGNING_DATE);
    const url = new URL(await signSpeakingObject(env, VIDEO, 'GET'));
    const reference = await sdkSignature('GET', VIDEO);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(`${ACCOUNT.toLowerCase()}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/waikan-2026-audio/${VIDEO}`);
    expect(Object.fromEntries(url.searchParams)).toEqual(reference.query);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.href).not.toContain(env.R2_SECRET_ACCESS_KEY);
  });

  it('PUT 同时签入准确字节数、媒体类型和禁止覆盖条件', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SIGNING_DATE);
    const url = new URL(await signSpeakingObject(env, USER_KEY, 'PUT', 'video/mp4', 123456));
    const reference = await sdkSignature('PUT', USER_KEY, {
      'content-type': 'video/mp4', 'content-length': '123456', 'if-none-match': '*',
    });
    expect(Object.fromEntries(url.searchParams)).toEqual(reference.query);
    expect(url.searchParams.get('X-Amz-SignedHeaders'))
      .toBe('content-length;content-type;host;if-none-match');
    for (const headers of [
      { 'content-type': 'video/webm', 'content-length': '123456', 'if-none-match': '*' },
      { 'content-type': 'video/mp4', 'content-length': '123457', 'if-none-match': '*' },
      { 'content-type': 'video/mp4', 'content-length': '123456', 'if-none-match': 'different' },
    ]) {
      expect((await sdkSignature('PUT', USER_KEY, headers)).query!['X-Amz-Signature'])
        .not.toBe(url.searchParams.get('X-Amz-Signature'));
    }
  });

  it.each([
    '', '/speaking/platform/film.mp4', 'speaking/platform/../film.mp4',
    'speaking/platform/./film.mp4', 'speaking/platform//film.mp4',
    'speaking/platform/%2e%2e/film.mp4', 'speaking/platform/film.mp4?overwrite=1',
    'speaking/platform/film.mp4\n', 'speaking/platform/film.mp4.',
    'users/not-a-uuid/33333333-3333-4333-8333-333333333333/source',
    'users/22222222-2222-4222-8222-222222222222/source',
    'economist/2026/audio.mp3', 'https://evil.example/film.mp4',
    'speaking\\platform\\film.mp4', `speaking/platform/${'a'.repeat(129)}`,
  ])('拒绝越界或非规范对象键 %s', async key => {
    expect(() => assertSpeakingObjectKey(key)).toThrow();
    await expect(signSpeakingObject(env, key, 'GET')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', statusCode: 400,
    });
  });

  it.each([
    { R2_ACCOUNT_ID: 'x'.repeat(32) }, { R2_ACCOUNT_ID: `${ACCOUNT}\n` },
    { R2_BUCKET_NAME: 'Uppercase' }, { R2_BUCKET_NAME: 'a.b' },
    { R2_BUCKET_NAME: '-invalid' }, { R2_BUCKET_NAME: 'invalid-' },
    { R2_BUCKET_NAME: 'ab' }, { R2_BUCKET_NAME: 'a'.repeat(64) },
    { R2_ACCESS_KEY_ID: undefined }, { R2_SECRET_ACCESS_KEY: 'invalid\nsecret' },
  ])('无效存储配置只返回稳定错误 %j', async invalid => {
    await expect(signSpeakingObject({ ...env, ...invalid } as ApiEnv, VIDEO, 'GET'))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_NOT_CONFIGURED', statusCode: 503 });
  });

  it.each([
    [undefined, 12], ['video/mp4', undefined], ['video/mp4', 0],
    ['video/mp4', 3 * 1024 ** 3 + 1], ['video/mp4', Number.NaN],
    ['video/mp4', 1.5], ['video/mp4\n', 12], ['video/mp4; charset=utf-8', 12],
  ] as Array<[string | undefined, number | undefined]>)('拒绝无效上传规格 %s %s', async (mime, bytes) => {
    await expect(signSpeakingObject(env, USER_KEY, 'PUT', mime, bytes))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('WebCrypto 异常不输出凭证或原错误', async () => {
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn(async () => { throw new Error(env.R2_SECRET_ACCESS_KEY); }) },
    });
    await expect(signSpeakingObject(env, VIDEO, 'GET')).rejects.toMatchObject({
      code: 'MEDIA_UNAVAILABLE', message: '媒体地址暂时无法生成，请稍后重试', retryable: true,
    });
  });
});
