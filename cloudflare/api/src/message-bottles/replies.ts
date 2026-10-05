import { MessageBottleReplySchema, type MessageBottleReply } from '@context-reader/contracts';
import type { ApiEnv } from '../env';

/** Only call with bottle IDs already selected under the viewer's visibility rules. */
export async function readMessageBottleReplies(env: ApiEnv, bottleIds: string[]): Promise<Map<string, MessageBottleReply>> {
  if (bottleIds.length === 0) return new Map();
  const rows = (await env.DB.prepare(`
    SELECT bottle_id AS bottleId, content, created_at AS createdAt, updated_at AS updatedAt
    FROM message_bottle_replies WHERE bottle_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(bottleIds)).all<MessageBottleReply & { bottleId: string }>()).results;
  return new Map(rows.map(({ bottleId, ...reply }) => [bottleId, MessageBottleReplySchema.parse(reply)]));
}
