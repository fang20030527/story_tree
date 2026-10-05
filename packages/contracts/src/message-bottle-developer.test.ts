import { describe, expect, it } from 'vitest';
import {
  MessageBottleDeveloperAccessSchema, MessageBottleReplyInputSchema, MessageBottleThreadDtoSchema,
  MessageBottleReviewedDtoSchema, MessageBottleDtoSchema, MessageBottleModerationQuerySchema, MessageBottleListQuerySchema,
} from './index';

const message = { id: '11111111-1111-4111-8111-111111111111', username: '读者', content: '留言', createdAt: '2026-10-05T00:00:00.000Z', isMine: false };
describe('开发者留言契约', () => {
  it('回复有独立严格契约，不扩展老客户端的 DTO', () => {
    const reviewed = { ...message, status: 'visible' };
    const thread = { ...reviewed, reply: { content: '谢谢', createdAt: message.createdAt, updatedAt: message.createdAt } };
    expect(MessageBottleDtoSchema.safeParse(message).success).toBe(true);
    expect(MessageBottleReviewedDtoSchema.safeParse(reviewed).success).toBe(true);
    expect(MessageBottleThreadDtoSchema.safeParse(thread).success).toBe(true);
    expect(MessageBottleReviewedDtoSchema.safeParse(thread).success).toBe(false);
    expect(MessageBottleDtoSchema.safeParse(thread).success).toBe(false);
    expect(MessageBottleThreadDtoSchema.safeParse({ ...thread, reply: { ...thread.reply, email: 'hidden@example.com' } }).success).toBe(false);
    expect(MessageBottleThreadDtoSchema.safeParse({ ...thread, userId: message.id }).success).toBe(false);
  });
  it('回复输入规范化、长度受限且不能指定作者', () => {
    expect(MessageBottleReplyInputSchema.parse({ content: ' 谢谢\n' })).toEqual({ content: '谢谢' });
    expect(MessageBottleReplyInputSchema.safeParse({ content: 'x'.repeat(1000) }).success).toBe(true);
    for (const input of [{ content: '  ' }, { content: 'x'.repeat(1001) }, { content: '回复', userId: message.id }])
      expect(MessageBottleReplyInputSchema.safeParse(input).success).toBe(false);
  });
  it('能力响应只能含布尔权限，分页和过滤值严格校验', () => {
    expect(MessageBottleDeveloperAccessSchema.safeParse({ canModerate: 'true' }).success).toBe(false);
    expect(MessageBottleDeveloperAccessSchema.safeParse({ canModerate: true, token: 'secret' }).success).toBe(false);
    expect(MessageBottleModerationQuerySchema.parse({})).toEqual({ view: 'pending', limit: 20 });
    expect(MessageBottleModerationQuerySchema.safeParse({ view: 'constructor' }).success).toBe(false);
    expect(MessageBottleModerationQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(MessageBottleListQuerySchema.safeParse({ includeReply: '1' }).success).toBe(true);
    expect(MessageBottleListQuerySchema.safeParse({ includeReply: 'true' }).success).toBe(false);
  });
});
