import { getCredential, setCredential, deleteCredential } from '@/api/credentialStorage';

import {
  RegisteredAuthResponseSchema,
  type RegisteredAuthResponse,
} from '@context-reader/contracts';

import {
  AUTH_USER_EMAIL_KEY,
  AUTH_USER_KEY,
  INSTALLATION_TOKEN_KEY,
} from '@/api/storage';

export async function saveAuthUser(user: RegisteredAuthResponse): Promise<void> {
  await setCredential(AUTH_USER_KEY, JSON.stringify(user));
  // A provider login without an email must not retain an older email account.
  await deleteCredential(AUTH_USER_EMAIL_KEY);
}

export async function loadAuthUser(): Promise<RegisteredAuthResponse | null> {
  const stored = await getCredential(AUTH_USER_KEY);
  if (!stored) return null;
  try {
    const parsed = RegisteredAuthResponseSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Store the email used for the current registered login for local display. */
export async function saveAuthUserEmail(email: string): Promise<void> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) return;
  await setCredential(AUTH_USER_EMAIL_KEY, normalizedEmail);
}

export async function loadAuthUserEmail(): Promise<string | null> {
  try {
    const stored = await getCredential(AUTH_USER_EMAIL_KEY);
    const normalizedEmail = stored?.trim();
    return normalizedEmail || null;
  } catch {
    return null;
  }
}

/** Remove the local bearer credential and all locally persisted auth identity. */
export async function clearAuthUser(): Promise<void> {
  await Promise.all([
    deleteCredential(AUTH_USER_KEY),
    deleteCredential(AUTH_USER_EMAIL_KEY),
    deleteCredential(INSTALLATION_TOKEN_KEY),
  ]);
}
