import { describe, expect, it } from 'vitest';
import {
  CreateMessageBottleSchema, MessageBottleDtoSchema, MessageBottleListQuerySchema,
  MessageBottlePageSchema, MessageBottleUsernameSchema,
} from './index';

describe('实名留言瓶契约', () => {
  it('规范化用户名和内容，同时保留留言段落', () => {
    expect(CreateMessageBottleSchema.parse({ username: '  Ａlice  ', content: '  建议增加\n阅读统计。  ' }))
      .toEqual({ username: 'Alice', content: '建议增加\n阅读统计。' });
    expect(MessageBottleUsernameSchema.safeParse('小林').success).toBe(true);
  });
  it('拒绝空白、过长内容、不合法署名和客户端伪造作者', () => {
    for (const content of ['', ' \n ', '字'.repeat(1001)]) {
      expect(CreateMessageBottleSchema.safeParse({ username: '小林', content }).success).toBe(false);
    }
    for (const username of ['a', '名'.repeat(25), 'a\nb', '<script>', 'a@b.com']) {
      expect(MessageBottleUsernameSchema.safeParse(username).success).toBe(false);
    }
    expect(CreateMessageBottleSchema.safeParse({ username: '小林', content: '建议', userId: crypto.randomUUID() }).success).toBe(false);
    expect(CreateMessageBottleSchema.safeParse({ username: '小林', content: '字'.repeat(1000) }).success).toBe(true);
  });
  it('严格校验分页数量和游标', () => {
    expect(MessageBottleListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(MessageBottleListQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    for (const query of [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: '' }, { cursor: 'bad' }, { unknown: 'x' }]) {
      expect(MessageBottleListQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it('公开响应含用户名且拒绝额外身份字段', () => {
    const message = { id: crypto.randomUUID(), username: '小林', content: '建议', createdAt: new Date().toISOString(), isMine: false };
    expect(MessageBottlePageSchema.parse({ items: [message], nextCursor: null }).items).toHaveLength(1);
    expect(MessageBottleDtoSchema.safeParse({ ...message, email: 'private@example.com' }).success).toBe(false);
  });
});
