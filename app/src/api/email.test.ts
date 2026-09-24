import { getInstallationToken } from './installation';
import { confirmPasswordReset, loginWithEmail, requestPasswordReset } from './email';
import { saveAuthUser } from '@/features/auth/authStorage';

jest.mock('./installation', () => ({
  getInstallationToken: jest.fn(),
}));
jest.mock('@/features/auth/authStorage', () => ({
  saveAuthUser: jest.fn(),
}));

const mockedGetInstallationToken = jest.mocked(getInstallationToken);
const mockedSaveAuthUser = jest.mocked(saveAuthUser);
const fetchMock = jest.fn();
const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

describe('Email API client', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    mockedGetInstallationToken.mockResolvedValue('b2'.repeat(32));
    global.fetch = fetchMock as typeof fetch;
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  });

  it('sends email credentials through the authenticated server route', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        userId: '22222222-2222-4222-8222-222222222222',
        kind: 'registered',
        remainingFreePractices: 3,
      }),
    });

    await expect(
      loginWithEmail('Reader@Example.com', 'correct-horse-battery-staple'),
    ).resolves.toMatchObject({ kind: 'registered' });
    expect(mockedSaveAuthUser).toHaveBeenCalledWith({
      userId: '22222222-2222-4222-8222-222222222222',
      kind: 'registered',
      remainingFreePractices: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/auth/email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'Reader@Example.com',
          password: 'correct-horse-battery-staple',
        }),
      }),
    );
  });

  it('requests and confirms password reset without an installation credential', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ message: '如果该邮箱已注册，重置验证码将发送至邮箱' }),
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ message: '密码已重置，请重新登录' }),
    });

    await requestPasswordReset('reader@example.com');
    await confirmPasswordReset('reader@example.com', 'ABCDEFGHJKLM', 'new-password-123');

    expect(mockedGetInstallationToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://api.example.test/v1/auth/password-reset/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'reader@example.com' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://api.example.test/v1/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'reader@example.com', code: 'ABCDEFGHJKLM', newPassword: 'new-password-123',
        }),
      }),
    );
  });
});
