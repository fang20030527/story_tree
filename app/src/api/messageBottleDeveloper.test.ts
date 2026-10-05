import {
  getMessageBottleDeveloperAccess, getModerationBottles, moderateMessageBottle, moderateMessageBottleAuthor,
  saveMessageBottleReply, deleteMessageBottleReply,
} from './messageBottleDeveloper';
import { getInstallationToken } from './installation';

jest.mock('./installation', () => ({ getInstallationToken: jest.fn().mockResolvedValue('normal-installation-token') }));
jest.mock('./deviceId', () => ({ getDeviceId: jest.fn().mockResolvedValue(null) }));
const originalFetch = global.fetch;
const originalBase = process.env.EXPO_PUBLIC_API_BASE_URL;
const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock; process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.com'; });
afterAll(() => {
  global.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalBase;
});
it('能力和审核列表使用现有安装令牌，不携带审核口令', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ canModerate: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ view: 'pending', items: [], nextCursor: null }) });
  expect(await getMessageBottleDeveloperAccess()).toEqual({ canModerate: true });
  await getModerationBottles('pending');
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://example.com/v1/developer/access', 'https://example.com/v1/developer/message-bottles?view=pending']);
  expect(getInstallationToken).toHaveBeenCalled();
  for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get('authorization')).toBe('Bearer normal-installation-token');
});
it('审核、禁言、保存和删除回复使用对应路由与严格内容', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  await moderateMessageBottle('id', 'approve');
  await moderateMessageBottleAuthor('author', 'ban');
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ reply: null }) });
  await saveMessageBottleReply('id', ' 回复 ');
  await deleteMessageBottleReply('id');
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ['https://example.com/v1/developer/message-bottles/id/approve', 'POST'],
    ['https://example.com/v1/developer/users/author/ban', 'POST'],
    ['https://example.com/v1/developer/message-bottles/id/reply', 'PUT'],
    ['https://example.com/v1/developer/message-bottles/id/reply', 'DELETE'],
  ]);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ content: '回复' });
});
