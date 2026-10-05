import { AccountProfileSchema, DeleteAccountRequestSchema, type AccountProfile } from '@context-reader/contracts';

import { apiRequest, apiRequestNoContent } from './client';

export function getAccountProfile(): Promise<AccountProfile> {
  return apiRequest('/v1/account', AccountProfileSchema);
}

/** 永久删除当前账号和它的全部云端数据；邮箱账号需要登录密码确认。 */
export function deleteAccount(password?: string): Promise<void> {
  return apiRequestNoContent('/v1/account/delete', {
    method: 'POST',
    body: JSON.stringify(DeleteAccountRequestSchema.parse(password ? { password } : {})),
  });
}

/** 修改当前账号的用户名；名字已被占用时服务端返回 409，错误信息可直接展示。 */
export function updateUsername(username: string): Promise<AccountProfile> {
  return apiRequest('/v1/account/username', AccountProfileSchema, {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}
