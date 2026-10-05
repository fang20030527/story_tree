import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { deleteAccount } from '@/api/account';
import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import { getBlockedUsers, unblockUser } from '@/api/messageBottles';
import {
  deleteVocabularyContext, getVocabularyWordContexts, renameVocabularyWord, updateVocabularyContext,
} from '@/api/practices';
import { notify } from '@/components/confirm';
import { clearAuthUser, loadAuthUser, loadAuthUserEmail } from '@/features/auth/authStorage';
import { PRIVACY_CONTACT_EMAIL } from '@/features/legal/privacyPolicy';

import AccountDeleteScreen from '../app/account-delete';
import BlockedUsersScreen from '../app/blocked-users';
import PrivacyPolicyScreen from '../app/privacy';
import SettingsScreen from '../app/settings';
import VocabularyEditScreen from '../app/vocabulary/edit';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light, preference: 'light', setPreference: jest.fn() }),
}));
jest.mock('@/components/confirm', () => ({
  confirmAction: (_options: unknown, onConfirm: () => void) => onConfirm(),
  notify: jest.fn(),
}));
jest.mock('@/api/account', () => ({ deleteAccount: jest.fn() }));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/api/messageBottles', () => ({ getBlockedUsers: jest.fn(), unblockUser: jest.fn() }));
jest.mock('@/api/practices', () => ({
  deleteVocabularyContext: jest.fn(), deleteVocabularyWord: jest.fn(), getVocabularyWordContexts: jest.fn(),
  renameVocabularyWord: jest.fn(), updateVocabularyContext: jest.fn(),
}));
jest.mock('@/features/auth/authStorage', () => ({
  clearAuthUser: jest.fn(), loadAuthUser: jest.fn(), loadAuthUserEmail: jest.fn(),
}));
jest.mock('@/features/speaking/speakingStorage', () => ({ speakingStorageKey: jest.fn(async () => 'speaking:v1:user-1') }));
jest.mock('@/features/library/libraryStorage', () => ({ clearRecentViews: jest.fn() }));

const wordId = '11111111-1111-4111-8111-111111111111';
const first = { id: '22222222-2222-4222-8222-222222222222', meaningZh: '收到', sourceSentence: null };
const second = { id: '33333333-3333-4333-8333-333333333333', meaningZh: '接待', sourceSentence: 'We received guests.' };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(loadAuthUser).mockResolvedValue({ userId: 'user-1', kind: 'registered', remainingFreePractices: 3 });
  jest.mocked(loadAuthUserEmail).mockResolvedValue('reader@example.com');
  jest.mocked(createIdempotencyKey).mockResolvedValue('rename-key-000000001');
});

describe('注销账号', () => {
  it('邮箱账号输入密码后注销，清除本机登录和这个账号的本地缓存', async () => {
    await AsyncStorage.setItem('speaking:v1:user-1', '{}');
    jest.mocked(deleteAccount).mockResolvedValue();
    const view = await render(<AccountDeleteScreen />);
    const button = await view.findByRole('button', { name: '永久注销账号' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(view.getByLabelText('登录密码'), 'secret-password');
    await fireEvent.press(view.getByRole('button', { name: '永久注销账号' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(deleteAccount).toHaveBeenCalledWith('secret-password');
    expect(clearAuthUser).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('speaking:v1:user-1')).toBeNull();
    expect(notify).toHaveBeenCalledWith('账号已注销', '账号和云端数据已删除。');
  });

  it('密码错误时保留账号并显示原因；重试时发现凭据已失效视为已注销', async () => {
    jest.mocked(deleteAccount).mockRejectedValueOnce(new ApiError('EMAIL_AUTH_FAILED', '密码错误，账号没有注销', false))
      .mockRejectedValueOnce(new ApiError('UNAUTHORIZED', '身份凭据无效', false));
    const view = await render(<AccountDeleteScreen />);
    await fireEvent.changeText(await view.findByLabelText('登录密码'), 'wrong-password');
    await fireEvent.press(view.getByRole('button', { name: '永久注销账号' }));
    await view.findByText('密码错误，账号没有注销');
    expect(clearAuthUser).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '永久注销账号' }));
    await waitFor(() => expect(clearAuthUser).toHaveBeenCalled());
  });

  it('游客不需要密码，可以删除云端数据', async () => {
    jest.mocked(loadAuthUser).mockResolvedValue(null);
    jest.mocked(deleteAccount).mockResolvedValue();
    const view = await render(<AccountDeleteScreen />);
    await fireEvent.press(await view.findByRole('button', { name: '删除云端数据' }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith(undefined));
    expect(view.queryByLabelText('登录密码')).toBeNull();
  });
});

describe('编辑生词', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ wordId, term: 'recieve' });
    jest.mocked(getVocabularyWordContexts).mockResolvedValue({ wordId, contexts: [first, second] });
  });

  it('修改拼写后改用新单词，重试同一拼写复用幂等键', async () => {
    const renamedId = '44444444-4444-4444-8444-444444444444';
    jest.mocked(renameVocabularyWord).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
      .mockResolvedValueOnce({ wordId: renamedId, term: 'receive' });
    const view = await render(<VocabularyEditScreen />);
    await fireEvent.changeText(await view.findByLabelText('单词拼写'), 'receive');
    await fireEvent.press(view.getByRole('button', { name: '保存拼写' }));
    await view.findByText('网络连接失败');
    await fireEvent.press(view.getByRole('button', { name: '保存拼写' }));
    await waitFor(() => expect(getVocabularyWordContexts).toHaveBeenLastCalledWith(renamedId));
    expect(jest.mocked(renameVocabularyWord).mock.calls).toEqual([
      [wordId, 'receive', 'rename-key-000000001'], [wordId, 'receive', 'rename-key-000000001'],
    ]);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('保存释义和例句，删除其中一个释义', async () => {
    jest.mocked(updateVocabularyContext).mockResolvedValue({ ...first, meaningZh: '收到；接到' });
    jest.mocked(deleteVocabularyContext).mockResolvedValue();
    const view = await render(<VocabularyEditScreen />);
    const meanings = await view.findAllByLabelText('中文释义');
    await fireEvent.changeText(meanings[0]!, '收到；接到');
    await fireEvent.press(view.getAllByRole('button', { name: '保存释义' })[0]!);
    await waitFor(() => expect(updateVocabularyContext).toHaveBeenCalledWith(first.id, { meaningZh: '收到；接到', sourceSentence: null }));
    await fireEvent.press(view.getAllByRole('button', { name: '删除这个释义' })[1]!);
    await waitFor(() => expect(deleteVocabularyContext).toHaveBeenCalledWith(second.id));
    await waitFor(() => expect(view.getAllByLabelText('中文释义')).toHaveLength(1));
    expect(view.queryByRole('button', { name: '删除这个释义' })).toBeNull();
  });
});

describe('隐私与屏蔽', () => {
  it('设置页提供屏蔽列表、隐私政策、注销账号和联系方式', async () => {
    const view = await render(<SettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: '已屏蔽的用户' }));
    await fireEvent.press(view.getByRole('button', { name: '隐私政策' }));
    await fireEvent.press(view.getByRole('button', { name: '注销账号' }));
    expect(jest.mocked(router.push).mock.calls).toEqual([['/blocked-users'], ['/privacy'], ['/account-delete']]);
    expect(view.getByText(PRIVACY_CONTACT_EMAIL)).toBeTruthy();
  });

  it('隐私政策说明数据出境、AI 处理方和删除方式', async () => {
    const view = await render(<PrivacyPolicyScreen />);
    expect(view.getByText('委托处理与数据出境')).toBeTruthy();
    expect(view.getByText(/EvoLink/)).toBeTruthy();
    expect(view.getByText(/设置 → 注销账号/)).toBeTruthy();
  });

  it('列出已屏蔽的用户并可以解除', async () => {
    jest.mocked(getBlockedUsers).mockResolvedValue([{ userId: wordId, username: '小张', blockedAt: '2026-10-05T00:00:00.000Z' }]);
    jest.mocked(unblockUser).mockResolvedValue();
    const view = await render(<BlockedUsersScreen />);
    await fireEvent.press(await view.findByRole('button', { name: '解除屏蔽 小张' }));
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith(wordId));
    await view.findByText(/没有屏蔽任何人/);
  });
});
