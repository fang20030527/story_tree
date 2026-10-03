import { getAccountProfile, updateUsername } from './account';
import { getInstallationToken } from './installation';

jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));
const fetchMock = jest.fn();
const previousFetch = global.fetch;
const previousBase = process.env.EXPO_PUBLIC_API_BASE_URL;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
  jest.mocked(getInstallationToken).mockResolvedValue('test-bearer');
});
afterAll(() => {
  global.fetch = previousFetch;
  if (previousBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = previousBase;
});

it('读取账号资料，使用安装身份认证', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ kind: 'registered', username: '小林' }) });
  await expect(getAccountProfile()).resolves.toEqual({ kind: 'registered', username: '小林' });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.example.com/v1/account');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-bearer');
});

it('拒绝服务端意外返回的额外身份字段', async () => {
  fetchMock.mockResolvedValue({
    ok: true, status: 200, json: async () => ({ kind: 'registered', username: '小林', email: 'private@example.com' }),
  });
  await expect(getAccountProfile()).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
});

it('用 PUT 提交新的用户名并返回更新后的资料', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ kind: 'registered', username: 'Alice' }) });
  await expect(updateUsername('Alice')).resolves.toEqual({ kind: 'registered', username: 'Alice' });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.example.com/v1/account/username');
  expect(init.method).toBe('PUT');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(JSON.parse(init.body as string)).toEqual({ username: 'Alice' });
});

it('名字被占用时把服务端的中文提示原样抛给界面', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      error: {
        code: 'STATE_CONFLICT', message: '这个用户名已被使用，请换一个',
        requestId: '11111111-1111-4111-8111-111111111111', retryable: false,
      },
    }),
  });
  await expect(updateUsername('Alice')).rejects.toMatchObject({
    code: 'STATE_CONFLICT', message: '这个用户名已被使用，请换一个',
  });
});
