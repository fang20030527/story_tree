import {
  EmailAuthResponseSchema,
  type EmailAuthResponse,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestResponseSchema,
  type PasswordResetConfirmResponse,
  type PasswordResetRequestResponse,
} from '@context-reader/contracts';

import { apiRequest, publicApiRequest } from './client';
import { saveAuthUser } from '@/features/auth/authStorage';

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<EmailAuthResponse> {
  const response = await apiRequest('/v1/auth/email', EmailAuthResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  try {
    await saveAuthUser(response);
  } catch {
    // Best-effort local persistence only; the server response is authoritative.
  }
  return response;
}

export function requestPasswordReset(email: string): Promise<PasswordResetRequestResponse> {
  return publicApiRequest(
    '/v1/auth/password-reset/request',
    PasswordResetRequestResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
  );
}

export function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<PasswordResetConfirmResponse> {
  return publicApiRequest(
    '/v1/auth/password-reset/confirm',
    PasswordResetConfirmResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword }),
    },
  );
}
