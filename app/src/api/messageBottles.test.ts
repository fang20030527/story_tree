import { blockMessageBottleAuthor, createMessageBottle, getMessageBottles, reportMessageBottle } from './messageBottles';
import { getInstallationToken } from './installation';

jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));
const fetchMock = jest.fn();
const previousFetch = global.fetch;
const previousBase = process.env.EXPO_PUBLIC_API_BASE_URL;
const message = { id: '11111111-1111-4111-8111-111111111111', username: '小林', content: '阅读统计', createdAt: '2026-10-03T01:00:00.000Z', isMine: true, status: 'pending', reply: null };
beforeEach(() => {
  fetchMock.mockReset(); global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
  jest.mocked(getInstallationToken).mockResolvedValue('test-bearer');
});
afterAll(() => {
  global.fetch = previousFetch;
  if (previousBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = previousBase;
});
it('发送实名契约和幂等键，使用安装身份认证', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => message });
  await expect(createMessageBottle({ username: ' 小林 ', content: ' 阅读统计 ' }, 'operation-00000000001')).resolves.toEqual(message);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.example.com/v1/message-bottles?includeStatus=1&includeReply=1');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-bearer');
  expect(new Headers(init.headers).get('Idempotency-Key')).toBe('operation-00000000001');
  expect(JSON.parse(init.body as string)).toEqual({ username: '小林', content: '阅读统计' });
});
it('游标按查询参数编码，拒绝服务端意外公开邮箱', async () => {
  const cursor = `${message.createdAt}_${message.id}`;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [message], nextCursor: null }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ ...message, email: 'private@example.com' }], nextCursor: null }) });
  await getMessageBottles(cursor);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://api.example.com/v1/message-bottles?includeStatus=1&includeReply=1&cursor=${encodeURIComponent(cursor)}`);
  await expect(getMessageBottles()).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
});
it('举报只发送原因，屏蔽通过留言编号指定作者，不暴露对方账号', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
  await reportMessageBottle(message.id, { reason: 'spam' });
  await blockMessageBottleAuthor(message.id);
  const [[reportUrl, reportInit], [blockUrl]] = fetchMock.mock.calls as [string, RequestInit][];
  expect(reportUrl).toBe(`https://api.example.com/v1/message-bottles/${message.id}/report`);
  expect(JSON.parse(reportInit!.body as string)).toEqual({ reason: 'spam' });
  expect(blockUrl).toBe(`https://api.example.com/v1/message-bottles/${message.id}/block`);
});
