import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakingAssetDtoSchema, type SpeakingAssetDto } from '@context-reader/contracts';
import type { ApiEnv } from '../env';
import { handleSpeakingAssetRoute, sweepSpeakingAssets } from './assets';

vi.mock('./signing', () => ({ signSpeakingObject: vi.fn(async (_env, key, method) => `https://media.example.test/${encodeURIComponent(key)}?method=${method}`) }));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const instances: Miniflare[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(instance => instance.dispose())); vi.clearAllMocks(); });
function wav() {
  const bytes = Buffer.alloc(32_044); bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32_000, 40);
  return bytes;
}
async function setup() {
  const instance = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default { fetch(){ return new Response("ok"); } }', d1Databases: { DB: 'speaking-assets-test' } }));
  instances.push(instance);
  const db = await instance.getD1Database('DB');
  const directory = resolve('cloudflare/api/migrations');
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(directory, name), 'utf8').split(/\r?\n/u).filter(line => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  for (const id of [owner, other]) await db.prepare('INSERT INTO users (id,kind,age_confirmed_at) VALUES (?,\'registered\',?)').bind(id, new Date().toISOString()).run();
  const objects = new Map<string, { bytes: Buffer; type: string; etag: string }>();
  const head = vi.fn(async (key: string) => {
    const object = objects.get(key); return object ? { size: object.bytes.length, etag: object.etag, httpEtag: `"${object.etag}"`, httpMetadata: { contentType: object.type } } : null;
  });
  const get = vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
    const object = objects.get(key); if (!object) return null;
    const offset = options?.range?.offset ?? 0;
    const bytes = object.bytes.subarray(offset, offset + (options?.range?.length ?? object.bytes.length));
    return { size: object.bytes.length, etag: object.etag, httpEtag: `"${object.etag}"`, body: new Response(new Uint8Array(bytes)).body!, httpMetadata: { contentType: object.type } };
  });
  const remove = vi.fn(async (key: string) => { objects.delete(key); });
  const env = { DB: db, SPEAKING_BUCKET: { head, get, delete: remove }, R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test-bucket' } as unknown as ApiEnv;
  async function put(asset: SpeakingAssetDto, bytes = wav(), type = 'audio/wav') {
    const row = await db.prepare('SELECT storage_key FROM speaking_assets WHERE id = ?').bind(asset.id).first<{storage_key:string}>();
    const etag = createHash('md5').update(bytes).digest('hex');
    objects.set(row!.storage_key, { bytes, type, etag }); return row!.storage_key;
  }
  return { db, env, objects, put, remove, head };
}
function request(path: string, method = 'GET', body?: unknown, key = 'asset-request-key-0001') {
  return new Request(`https://blackholeenglish.com/v1/speaking/${path}`, { method,
    headers: { 'content-type': 'application/json', 'idempotency-key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function reserve(env: ApiEnv, key = 'asset-reserve-key-0001', byteSize = wav().length) {
  const response = await handleSpeakingAssetRoute(request('assets', 'POST', { contentType: 'audio/wav', byteSize, purpose: 'material' }, key), env, owner);
  return SpeakingAssetDtoSchema.parse(await response!.json());
}
async function complete(env: ApiEnv, id: string, duration = 1, key = 'asset-complete-key-0001') {
  return handleSpeakingAssetRoute(request(`assets/${id}/complete`, 'POST', { duration }, key), env, owner);
}

describe('Worker speaking assets', () => {
  it('reserves a private conditional upload, replays the same asset and rejects a changed payload', async () => {
    const { env, db } = await setup();
    const first = await reserve(env);
    expect(first.status).toBe('awaiting_upload'); expect(first.directUpload?.url).toContain('method=PUT');
    expect((await reserve(env)).id).toBe(first.id);
    await expect(reserve(env, 'asset-reserve-key-0001', 100)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await db.prepare('SELECT COUNT(*) AS total FROM speaking_assets').first()).toEqual({ total: 1 });
  });
  it('confirms actual R2 media then allows only its owner to obtain a short-lived playback', async () => {
    const { env, put } = await setup(); const asset = await reserve(env); await put(asset);
    const confirmed = SpeakingAssetDtoSchema.parse(await (await complete(env, asset.id))!.json());
    expect(confirmed).toMatchObject({ status: 'ready', duration: 1 }); expect(confirmed.directUpload).toBeUndefined();
    expect((await complete(env, asset.id))!.status).toBe(200);
    expect((await handleSpeakingAssetRoute(request(`assets/${asset.id}/playback`), env, owner))!.headers.get('cache-control')).toBe('no-store');
    await expect(handleSpeakingAssetRoute(request(`assets/${asset.id}/playback`), env, other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(handleSpeakingAssetRoute(request(`assets/${asset.id}/complete`, 'POST', { duration: 1 }), env, other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects missing media, changed size/type, false media headers and confirmation changes', async () => {
    const { env, put } = await setup(); const asset = await reserve(env);
    await expect(complete(env, asset.id)).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });
    await put(asset, Buffer.alloc(10)); await expect(complete(env, asset.id)).rejects.toMatchObject({ code: 'IMPORT_CONTENT_INVALID' });
    await put(asset, wav(), 'video/mp4'); await expect(complete(env, asset.id)).rejects.toMatchObject({ code: 'IMPORT_CONTENT_INVALID' });
    await put(asset, Buffer.alloc(wav().length)); await expect(complete(env, asset.id)).rejects.toMatchObject({ code: 'IMPORT_UNSUPPORTED_TYPE' });
    await put(asset); await complete(env, asset.id);
    await expect(complete(env, asset.id, 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(complete(env, asset.id, 2, 'different-complete-0001')).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
  it('atomically enforces reserved capacity under concurrent requests', async () => {
    const { env, db } = await setup();
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => reserve(env, `quota-reserve-key-${i}`, 3 * 1024 ** 3)));
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(3);
    expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(await db.prepare('SELECT COUNT(*) AS total FROM speaking_assets').first()).toEqual({ total: 3 });
  });
  it('cannot confirm two assets using the same conflicting idempotency key', async () => {
    const { env, db, put } = await setup(); const a = await reserve(env, 'reserve-a-key-000001'); const b = await reserve(env, 'reserve-b-key-000001');
    await put(a); await put(b);
    const results = await Promise.allSettled([complete(env, a.id), complete(env, b.id)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) AS total FROM speaking_assets WHERE status='ready'").first()).toEqual({ total: 1 });
  });
  it('retains cleanup pointers through R2 failure and preserves attached/fixed resources', async () => {
    const { env, db, put, objects, remove } = await setup(); const expired = await reserve(env, 'cleanup-expired-key-01'); const attached = await reserve(env, 'cleanup-attached-key-1');
    const expiredKey = await put(expired); const attachedKey = await put(attached);
    const past = new Date(Date.now() - 60_000).toISOString();
    await db.prepare('UPDATE speaking_assets SET expires_at = ? WHERE id IN (?,?)').bind(past, expired.id, attached.id).run();
    await db.prepare('UPDATE speaking_assets SET attached_at = ? WHERE id = ?').bind(past, attached.id).run();
    remove.mockRejectedValueOnce(new Error('temporary-test-failure'));
    await sweepSpeakingAssets(env);
    expect(objects.has(expiredKey)).toBe(true); expect(objects.has(attachedKey)).toBe(true);
    expect(await db.prepare('SELECT COUNT(*) AS total FROM speaking_storage_cleanup').first()).toEqual({ total: 1 });
    await sweepSpeakingAssets(env);
    expect(objects.has(expiredKey)).toBe(false); expect(objects.has(attachedKey)).toBe(true);
    expect(await db.prepare('SELECT COUNT(*) AS total FROM speaking_storage_cleanup').first()).toEqual({ total: 0 });
    expect(remove.mock.calls.every(call => call[0].startsWith('users/'))).toBe(true);
  });
});
