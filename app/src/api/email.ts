import {
  EmailAuthResponseSchema,
  type EmailAuthResponse,
} from '@context-reader/contracts';

import { apiRequest } from './client';
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
