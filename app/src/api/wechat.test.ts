import { getInstallationToken } from './installation';
import { loginWithWechat } from './wechat';
import { requestWechatCode } from '@/features/auth/wechat';
import { saveAuthUser } from '@/features/auth/authStorage';

jest.mock('./installation', () => ({
  getInstallationToken: jest.fn(),
}));
jest.mock('@/features/auth/wechat', () => ({
  requestWechatCode: jest.fn(),
}));
jest.mock('@/features/auth/authStorage', () => ({
  saveAuthUser: jest.fn(),
}));

const mockedGetInstallationToken = jest.mocked(getInstallationToken);
const mockedRequestWechatCode = jest.mocked(requestWechatCode);
const mockedSaveAuthUser = jest.mocked(saveAuthUser);
const fetchMock = jest.fn();
const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

describe('WeChat API client', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    mockedGetInstallationToken.mockResolvedValue('a1'.repeat(32));
    mockedRequestWechatCode.mockResolvedValue('native-wechat-code');
    global.fetch = fetchMock as typeof fetch;
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  });

  it('exchanges the native code through the authenticated server route', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        userId: '11111111-1111-4111-8111-111111111111',
        kind: 'registered',
        remainingFreePractices: 3,
      }),
    });

    await expect(loginWithWechat()).resolves.toMatchObject({
      kind: 'registered',
    });
    expect(mockedSaveAuthUser).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      kind: 'registered',
      remainingFreePractices: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/auth/wechat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'native-wechat-code' }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('Authorization')).toBe(
      `Bearer ${'a1'.repeat(32)}`,
    );
  });

  it('does not call the API when native code acquisition fails', async () => {
    mockedRequestWechatCode.mockRejectedValue(
      new Error('请安装开发构建后重试'),
    );

    await expect(loginWithWechat()).rejects.toThrow('请安装开发构建后重试');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
