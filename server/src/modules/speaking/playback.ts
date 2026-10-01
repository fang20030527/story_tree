import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SpeakingPlaybackDtoSchema, UuidSchema } from '@context-reader/contracts';
import { AppError } from '../../core/errors';
import { getOwnedSpeakingAsset, requireMediaStore, type SpeakingMediaDependencies } from './assets';

const TicketSchema = z.object({ assetId: UuidSchema, userId: UuidSchema,
  expiresAt: z.number().int().positive() }).strict();

export class SpeakingPlaybackSigner {
  private readonly secret: Buffer;
  constructor(secret: string = '') { this.secret = secret ? Buffer.from(secret) : randomBytes(32); }
  sign(assetId: string, userId: string, expiresAt: number) {
    const payload = Buffer.from(JSON.stringify({ assetId, userId, expiresAt })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
  }
  verify(value: unknown, assetId: string) {
    if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) throw invalidTicket();
    const [payload, signed] = value.split('.');
    const expected = createHmac('sha256', this.secret).update(payload!).digest();
    const signature = Buffer.from(signed!, 'base64url');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw invalidTicket();
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')); } catch { throw invalidTicket(); }
    const parsed = TicketSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.assetId !== assetId || parsed.data.expiresAt <= Date.now()) throw invalidTicket();
    return parsed.data;
  }
}

export async function getSpeakingPlayback(deps: SpeakingMediaDependencies, signer: SpeakingPlaybackSigner,
  userId: string, assetId: string) {
  const store = requireMediaStore(deps);
  const asset = await getOwnedSpeakingAsset(deps.db, userId, assetId);
  if (asset.status !== 'ready' || !asset.storageKey) throw new AppError('STATE_CONFLICT', '媒体尚未完成上传', 409);
  const lifetimeSeconds = 600;
  const expiresAt = Date.now() + lifetimeSeconds * 1000;
  const url = store.signedReadUrl ? await store.signedReadUrl(asset.storageKey, lifetimeSeconds) :
    `${deps.config.publicServerOrigin}/v1/speaking/assets/${assetId}/play?ticket=${signer.sign(assetId, userId, expiresAt)}`;
  return SpeakingPlaybackDtoSchema.parse({ url, expiresAt: new Date(expiresAt).toISOString() });
}

export async function serveSpeakingMedia(deps: SpeakingMediaDependencies, signer: SpeakingPlaybackSigner,
  assetId: string, request: FastifyRequest, reply: FastifyReply) {
  const store = requireMediaStore(deps);
  const query = request.query as { ticket?: unknown };
  const ticket = signer.verify(query.ticket, assetId);
  const asset = await getOwnedSpeakingAsset(deps.db, ticket.userId, assetId);
  if (asset.status !== 'ready' || !asset.storageKey) throw new AppError('NOT_FOUND', '媒体文件不存在', 404);
  const info = await store.stat(asset.storageKey);
  if (!info || info.byteSize !== asset.byteSize) throw new AppError('MEDIA_UNAVAILABLE', '媒体暂时不可用，请稍后重试', 503, true);
  reply.header('cache-control', 'private, no-store');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', asset.contentType);
  reply.header('etag', `"${asset.sha256}"`);
  const range = mediaRange(request.headers.range, info.byteSize);
  if (range === false) {
    reply.header('content-range', `bytes */${info.byteSize}`);
    return reply.status(416).send();
  }
  const selected = range ?? { start: 0, end: info.byteSize - 1 };
  reply.header('content-length', String(selected.end - selected.start + 1));
  if (range) { reply.status(206); reply.header('content-range', `bytes ${range.start}-${range.end}/${info.byteSize}`); }
  if (request.method === 'HEAD') return reply.send();
  const stream = await store.openRead(asset.storageKey, selected);
  request.raw.once('aborted', () => stream.destroy());
  reply.raw.once('close', () => stream.destroy());
  return reply.send(stream);
}

export function mediaRange(header: string | undefined, size: number): { start: number; end: number } | null | false {
  if (header === undefined) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || (!match[1] && !match[2])) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}
function invalidTicket() { return new AppError('UNAUTHORIZED', '播放链接已失效，请重新打开素材', 401, true); }
