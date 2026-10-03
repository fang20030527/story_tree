import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { MessageBottlePageSchema } from '@context-reader/contracts';
import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { installations, messageBottles, users } from '../../db/schema';
import { hashInstallationToken } from '../auth/token';
import { createMessageBottle, getMessageBottlePage } from './service';

const config = loadConfig({ DATABASE_URL: 'postgresql://example.invalid/db', EVOLINK_API_KEY: 'test-key', PUBLIC_SERVER_ORIGIN: 'http://localhost:3000' });
it('注册账号实名发布、持久署名、幂等重放、跨账号分页及 HTTP 身份校验', async () => {
  await withTestDatabase(async ({ db }) => {
    const owner = crypto.randomUUID(); const other = crypto.randomUUID(); const guest = crypto.randomUUID();
    await db.insert(users).values([owner, other, guest].map(id => ({ id, kind: id === guest ? 'guest' as const : 'registered' as const, ageConfirmedAt: new Date() })));
    const input = { username: '小林', content: '希望增加阅读统计。' }; const key = crypto.randomUUID();
    const [first, replay] = await Promise.all([0, 1].map(() => createMessageBottle(db, owner, input, key)));
    expect(first).toEqual(replay);
    expect((await db.select().from(messageBottles))).toHaveLength(1);
    expect((await db.select().from(users).where(eq(users.id, owner)))[0]?.username).toBe('小林');
    await expect(createMessageBottle(db, owner, { ...input, content: '不同意见' }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(createMessageBottle(db, owner, { ...input, username: '另一个名字' }, crypto.randomUUID())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(createMessageBottle(db, other, input, crypto.randomUUID())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(createMessageBottle(db, guest, input, crypto.randomUUID())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await createMessageBottle(db, other, { ...input, username: '小张' }, crypto.randomUUID());
    const page = await getMessageBottlePage(db, guest, { limit: 1 });
    expect(page.items[0]?.isMine).toBe(false); expect(JSON.stringify(page)).not.toContain(owner);
    const next = await getMessageBottlePage(db, guest, { limit: 1, cursor: page.nextCursor! });
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id); expect(next.nextCursor).toBeNull();
    const token = 'ab'.repeat(32);
    await db.insert(installations).values({ userId: guest, tokenHash: hashInstallationToken(token) });
    const app = buildApp({ config, db, logger: false });
    try {
      expect((await app.inject({ url: '/v1/message-bottles' })).statusCode).toBe(401);
      const response = await app.inject({ url: '/v1/message-bottles', headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200); expect(MessageBottlePageSchema.parse(response.json()).items).toHaveLength(2);
      const rejected = await app.inject({ url: '/v1/message-bottles', method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() }, payload: input });
      expect(rejected.statusCode).toBe(403);
    } finally { await app.close(); }
    for (let i = 0; i < 3; i++) await createMessageBottle(db, owner, { ...input, content: `建议${i}` }, crypto.randomUUID());
    const outcomes = await Promise.allSettled([0, 1].map(() => createMessageBottle(db, owner, input, crypto.randomUUID())));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'RATE_LIMITED' } });
    expect(await createMessageBottle(db, owner, input, key)).toEqual(first);
  });
}, 120_000);
