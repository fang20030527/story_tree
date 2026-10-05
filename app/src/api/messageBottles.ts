import {
  BlockedUsersSchema, CreateMessageBottleSchema, MessageBottleProfileSchema, MessageBottleThreadDtoSchema,
  MessageBottleThreadPageSchema, ReportMessageBottleRequestSchema,
  type BlockedUser, type CreateMessageBottle, type MessageBottleProfile, type MessageBottleThreadDto,
  type MessageBottleThreadPage, type ReportMessageBottleRequest,
} from '@context-reader/contracts';
import { apiRequest, apiRequestNoContent } from './client';

/** Includes each bottle's review status, so authors can see which of theirs wait for review. */
export function getMessageBottles(cursor?: string): Promise<MessageBottleThreadPage> {
  const query = new URLSearchParams({ includeStatus: '1', includeReply: '1', ...(cursor ? { cursor } : {}) });
  return apiRequest(`/v1/message-bottles?${query}`, MessageBottleThreadPageSchema);
}
export function getMessageBottleProfile(): Promise<MessageBottleProfile> {
  return apiRequest('/v1/message-bottles/profile', MessageBottleProfileSchema);
}
export function createMessageBottle(input: CreateMessageBottle, key: string): Promise<MessageBottleThreadDto> {
  return apiRequest('/v1/message-bottles?includeStatus=1&includeReply=1', MessageBottleThreadDtoSchema, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(CreateMessageBottleSchema.parse(input)),
  });
}
/** 举报后这条留言对自己立即隐藏；多人举报的留言会暂时下架，等待人工审核。 */
export function reportMessageBottle(id: string, input: ReportMessageBottleRequest): Promise<void> {
  return apiRequestNoContent(`/v1/message-bottles/${encodeURIComponent(id)}/report`, {
    method: 'POST', body: JSON.stringify(ReportMessageBottleRequestSchema.parse(input)),
  });
}
/** 屏蔽这条留言的作者：之后看不到对方的任何留言，可在设置里解除。 */
export function blockMessageBottleAuthor(id: string): Promise<void> {
  return apiRequestNoContent(`/v1/message-bottles/${encodeURIComponent(id)}/block`, { method: 'POST', body: '{}' });
}
export async function getBlockedUsers(): Promise<BlockedUser[]> {
  return (await apiRequest('/v1/blocked-users', BlockedUsersSchema)).users;
}
export function unblockUser(userId: string): Promise<void> {
  return apiRequestNoContent(`/v1/blocked-users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
