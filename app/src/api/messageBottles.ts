import {
  CreateMessageBottleSchema, MessageBottleDtoSchema, MessageBottlePageSchema, MessageBottleProfileSchema,
  type CreateMessageBottle, type MessageBottleDto, type MessageBottlePage, type MessageBottleProfile,
} from '@context-reader/contracts';
import { apiRequest } from './client';

export function getMessageBottles(cursor?: string): Promise<MessageBottlePage> {
  return apiRequest(`/v1/message-bottles${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, MessageBottlePageSchema);
}
export function getMessageBottleProfile(): Promise<MessageBottleProfile> {
  return apiRequest('/v1/message-bottles/profile', MessageBottleProfileSchema);
}
export function createMessageBottle(input: CreateMessageBottle, key: string): Promise<MessageBottleDto> {
  return apiRequest('/v1/message-bottles', MessageBottleDtoSchema, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(CreateMessageBottleSchema.parse(input)),
  });
}
