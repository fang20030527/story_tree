import {
  WechatAuthResponseSchema,
  type WechatAuthResponse,
} from '@context-reader/contracts';

import { apiRequest } from './client';
import { requestWechatCode } from '@/features/auth/wechat';
import { saveAuthUser } from '@/features/auth/authStorage';

export async function loginWithWechat(): Promise<WechatAuthResponse> {
  const code = await requestWechatCode();
  const response = await apiRequest('/v1/auth/wechat', WechatAuthResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  // Persisting the display state should never turn a successful server login
  // into a failed login (for example when SecureStore is unavailable on a
  // development device). Keep the API response authoritative.
  try {
    await saveAuthUser(response);
  } catch {
    // Best-effort local persistence only.
  }
  return response;
}
