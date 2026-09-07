import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppTransaction } from '../../db/client';
import { idempotencyRecords } from '../../db/schema';

export type IdempotencyOperation =
  | 'create_practice'
  | 'request_translation'
  | 'record_assistance'
  | 'submit_answer';

const resourceTypes: Record<IdempotencyOperation, string> = {
  create_practice: 'practice',
  request_translation: 'translation',
  record_assistance: 'assistance',
  submit_answer: 'answer',
};

const pendingRequestHashes = new WeakMap<object, Map<string, string>>();

export async function beginIdempotentOperation(
  tx: AppTransaction,
  userId: string,
  operation: IdempotencyOperation,
  idempotencyKey: string,
  requestMaterial: unknown,
): Promise<string | null> {
  const requestHash = hashRequestMaterial(requestMaterial);
  const identity = operationIdentity(userId, operation, idempotencyKey);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identity}))`);

  const [existing] = await tx
    .select({
      requestHash: idempotencyRecords.requestHash,
      resourceId: idempotencyRecords.resourceId,
    })
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.userId, userId),
        eq(idempotencyRecords.operation, operation),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        '幂等键已用于不同请求',
        409,
      );
    }
    return existing.resourceId;
  }

  const pending = pendingRequestHashes.get(tx) ?? new Map<string, string>();
  pending.set(identity, requestHash);
  pendingRequestHashes.set(tx, pending);
  return null;
}

export async function finishIdempotentOperation(
  tx: AppTransaction,
  userId: string,
  operation: IdempotencyOperation,
  idempotencyKey: string,
  resourceId: string,
): Promise<void> {
  const identity = operationIdentity(userId, operation, idempotencyKey);
  const requestHash = pendingRequestHashes.get(tx)?.get(identity);
  if (!requestHash) {
    throw new AppError('INTERNAL_ERROR', '幂等请求状态无效', 500, true);
  }

  await tx.insert(idempotencyRecords).values({
    userId,
    operation,
    idempotencyKey,
    requestHash,
    resourceType: resourceTypes[operation],
    resourceId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
  });
  pendingRequestHashes.get(tx)?.delete(identity);
}

function hashRequestMaterial(requestMaterial: unknown): string {
  const serialized = JSON.stringify(canonicalize(requestMaterial)) ?? 'undefined';
  return createHash('sha256').update(serialized).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function operationIdentity(
  userId: string,
  operation: IdempotencyOperation,
  idempotencyKey: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([userId, operation, idempotencyKey]))
    .digest('hex');
}
