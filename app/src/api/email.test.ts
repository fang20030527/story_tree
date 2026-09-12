import { getInstallationToken } from './installation';
import { loginWithEmail } from './email';
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
});
