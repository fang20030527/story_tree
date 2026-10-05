import {
  MessageBottleDeveloperAccessSchema, MessageBottleModerationPageSchema, MessageBottleModerationResultSchema,
  MessageBottleReplyInputSchema, MessageBottleReplyResultSchema, type MessageBottleModerationView,
} from '@context-reader/contracts';
import { apiRequest } from './client';

export const getMessageBottleDeveloperAccess = () => apiRequest('/v1/developer/access', MessageBottleDeveloperAccessSchema);
export function getModerationBottles(view: MessageBottleModerationView, cursor?: string) {
  const query = new URLSearchParams({ view, ...(cursor ? { cursor } : {}) });
  return apiRequest(`/v1/developer/message-bottles?${query}`, MessageBottleModerationPageSchema);
}
export function moderateMessageBottle(id: string, action: 'approve' | 'hide' | 'delete') {
  return apiRequest(`/v1/developer/message-bottles/${encodeURIComponent(id)}/${action}`, MessageBottleModerationResultSchema, { method: 'POST' });
}
export function moderateMessageBottleAuthor(id: string, action: 'ban' | 'unban') {
  return apiRequest(`/v1/developer/users/${encodeURIComponent(id)}/${action}`, MessageBottleModerationResultSchema, { method: 'POST' });
}
export function saveMessageBottleReply(id: string, content: string) {
  return apiRequest(`/v1/developer/message-bottles/${encodeURIComponent(id)}/reply`, MessageBottleReplyResultSchema, {
    method: 'PUT', body: JSON.stringify(MessageBottleReplyInputSchema.parse({ content })),
  });
}
export function deleteMessageBottleReply(id: string) {
  return apiRequest(`/v1/developer/message-bottles/${encodeURIComponent(id)}/reply`, MessageBottleReplyResultSchema, { method: 'DELETE' });
}
