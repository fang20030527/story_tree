import {
  EmailAuthResponseSchema,
  type EmailAuthResponse,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestResponseSchema,
  type PasswordResetConfirmResponse,
  type PasswordResetRequestResponse,
} from '@context-reader/contracts';

import { apiRequestWithStatus, publicApiRequest } from './client';
import { saveAuthUser } from '@/features/auth/authStorage';

export interface EmailLoginResult extends EmailAuthResponse {
  /** 服务端以 201 表示这次请求新建了账号（邮箱此前未注册）。 */
  created: boolean;
}

/**
 * 邮箱登录；邮箱未注册时自动创建账号。`username` 只在创建新账号时使用，
 * 已有账号登录会忽略它；不传则由服务端自动生成。
 */
export async function loginWithEmail(
  email: string,
  password: string,
  username?: string,
): Promise<EmailLoginResult> {
  const { data, status } = await apiRequestWithStatus('/v1/auth/email', EmailAuthResponseSchema, {
    method: 'POST',
    body: JSON.stringify(username ? { email, password, username } : { email, password }),
  });
  try {
    await saveAuthUser(data);
  } catch {
    // Best-effort local persistence only; the server response is authoritative.
  }
  return { ...data, created: status === 201 };
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
