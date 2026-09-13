import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CreatedComputerUploadSessionSchema,
  UuidSchema,
  type CreatedComputerUploadSession,
} from '@context-reader/contracts';

import { createIdempotencyKey } from '@/api/installation';
import {
  ACTIVE_COMPUTER_SESSION_KEY,
  ACTIVE_IMPORT_ID_KEY,
  IMPORT_OPERATION_KEY_PREFIX,
} from '@/api/storage';

export async function loadActiveImportId(): Promise<string | null> {
  const value = await AsyncStorage.getItem(ACTIVE_IMPORT_ID_KEY);
  const parsed = UuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function saveActiveImportId(importId: string): Promise<void> {
  return AsyncStorage.setItem(ACTIVE_IMPORT_ID_KEY, UuidSchema.parse(importId));
}

export function clearActiveImportId(): Promise<void> {
  return AsyncStorage.removeItem(ACTIVE_IMPORT_ID_KEY);
}

export async function clearActiveImportIdIfMatches(importId: string): Promise<void> {
  if (await loadActiveImportId() !== importId) return;
  await clearActiveImportId();
}

export function saveActiveComputerSessionId(sessionId: string): Promise<void> {
  return AsyncStorage.setItem(
    ACTIVE_COMPUTER_SESSION_KEY,
    UuidSchema.parse(sessionId),
  );
}

export function saveActiveComputerSession(
  session: CreatedComputerUploadSession,
): Promise<void> {
  const parsed = CreatedComputerUploadSessionSchema.parse(session);
  return AsyncStorage.setItem(
    ACTIVE_COMPUTER_SESSION_KEY,
    JSON.stringify(parsed),
  );
}

export async function loadActiveComputerSessionId(): Promise<string | null> {
  const value = await AsyncStorage.getItem(ACTIVE_COMPUTER_SESSION_KEY);
  if (value?.startsWith('{')) {
    try {
      const session = CreatedComputerUploadSessionSchema.safeParse(JSON.parse(value));
      return session.success ? session.data.sessionId : null;
    } catch {
      return null;
    }
  }
  const parsed = UuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function loadActiveComputerSession(): Promise<CreatedComputerUploadSession | null> {
  const value = await AsyncStorage.getItem(ACTIVE_COMPUTER_SESSION_KEY);
  if (!value) return null;
  try {
    const parsed = CreatedComputerUploadSessionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearActiveComputerSessionId(): Promise<void> {
  return AsyncStorage.removeItem(ACTIVE_COMPUTER_SESSION_KEY);
}

function operationStorageKey(importId: string, operation: string): string {
  return `${IMPORT_OPERATION_KEY_PREFIX}${UuidSchema.parse(importId)}_${operation}`;
}

/**
 * Idempotency keys are retained per import operation so a retry after a
 * network interruption cannot create a second draft or confirmation.
 */
export async function loadOrCreateImportOperationKey(
  importId: string,
  operation: string,
): Promise<string> {
  const key = operationStorageKey(importId, operation);
  const stored = await AsyncStorage.getItem(key);
  if (stored) return stored;
  const created = await createIdempotencyKey();
  await AsyncStorage.setItem(key, created);
  return created;
}

export function clearImportOperationKeys(importId: string): Promise<void> {
  const id = UuidSchema.parse(importId);
  return AsyncStorage.getAllKeys().then((keys) =>
    AsyncStorage.multiRemove(
      keys.filter((key) =>
        key.startsWith(`${IMPORT_OPERATION_KEY_PREFIX}${id}_`),
      ),
    ),
  );
}
