import { AccountProfileSchema, type AccountProfile } from '@context-reader/contracts';

import { apiRequest } from './client';

export function getAccountProfile(): Promise<AccountProfile> {
  return apiRequest('/v1/account', AccountProfileSchema);
}

/** 修改当前账号的用户名；名字已被占用时服务端返回 409，错误信息可直接展示。 */
export function updateUsername(username: string): Promise<AccountProfile> {
  return apiRequest('/v1/account/username', AccountProfileSchema, {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}
