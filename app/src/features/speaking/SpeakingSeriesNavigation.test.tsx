import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { SpeakingHomeScreen } from './SpeakingHomeScreen';
import { SpeakingSectionScreen } from './SpeakingSectionScreen';
import { SpeakingSeriesScreen } from './SpeakingSeriesScreen';
import { useSpeakingLibrary } from './useSpeakingLibrary';

let mockParams: { section?: string; query?: string; series?: string } = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('./useSpeakingLibrary', () => ({ useSpeakingLibrary: jest.fn() }));
jest.mock('./SpeakingComponents', () => ({
  ...jest.requireActual('./SpeakingComponents'), SpeakingHeader: () => null, SpeakingStatus: () => null,
}));
jest.mock('@/components/brand', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PageHeading: ({ title, description }: { title: string; description: string }) => React.createElement(Text, null, `${title} ${description}`),
    BrandHeader: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement(Pressable, { accessibilityLabel: label, onPress }),
  };
});

function material(id: string, title: string, category = '美剧/英剧'): SpeakingMaterial {
  return { id, title, category, subtitle: '', origin: 'platform', mediaType: 'video', duration: 1_300, cues: [] };
}
const materials = [material('steve-jobs-stanford-2005', '斯蒂夫·乔布斯', '演讲片段'),
  material('friends-s01e24', '老友记 · S01E24'), material('rick-and-morty-s08e10', '瑞克和莫蒂 · S08E10'),
  material('friends-s01e01', '老友记 · S01E01'), material('friends-s01e02', '老友记 · S01E02'),
  material('rick-and-morty-s08e01', '瑞克和莫蒂 · S08E01')];

beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  const store = emptySpeakingStore(); store.positions['friends-s01e24'] = 33;
  jest.mocked(useSpeakingLibrary).mockReturnValue({ materials, store, scope: 'speaking:v1:guest', cloud: false,
    loading: false, error: '', catalogError: '', loadingMore: false, moreError: '', hasMore: false,
    loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
});

it('主页只展示剧名，点击剧名进入选集，更多进入电视剧栏目', async () => {
  const view = await render(<SpeakingHomeScreen />);
  expect(view.queryByText('老友记 · S01E24')).toBeNull();
  expect(view.queryByText('瑞克和莫蒂 · S08E10')).toBeNull();
  await fireEvent.press(view.getByLabelText('打开老友记选集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/series', params: { series: 'friends' } });
  await fireEvent.press(view.getByLabelText('查看更多美剧/英剧素材'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/section', params: { section: '美剧/英剧' } });
  await fireEvent.press(view.getByLabelText('查找跟读素材'));
  await fireEvent.changeText(view.getByLabelText('搜索跟读素材'), 'Friends');
  expect(view.getByLabelText('打开老友记选集')).toBeTruthy();
  expect(view.getByText('第1季 · 3集')).toBeTruthy();
  await view.unmount();
});

it('更多按剧显示，搜索具体一集仍保留整部剧的入口及集数', async () => {
  mockParams = { section: '美剧/英剧' };
  const view = await render(<SpeakingSectionScreen />);
  expect(view.getByText('美剧/英剧 共 2 部电视剧')).toBeTruthy();
  expect(view.queryByLabelText('打开老友记 · S01E24')).toBeNull();
  await fireEvent.press(view.getByLabelText('打开瑞克和莫蒂选集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/series', params: { series: 'rick-and-morty' } });
  await fireEvent.changeText(view.getByLabelText('搜索电视剧'), 's01e24');
  expect(view.getByLabelText('打开老友记选集')).toBeTruthy();
  expect(view.queryByLabelText('打开瑞克和莫蒂选集')).toBeNull();
  expect(view.getByText('第1季 · 3集')).toBeTruthy();
  await view.unmount();
});

it('选集页保留跟读进度，切换季后打开对应素材', async () => {
  mockParams = { series: 'friends' };
  const current = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...current, materials: [...materials, material('friends-s02e03', '老友记 · S02E03')] });
  const view = await render(<SpeakingSeriesScreen />);
  expect(view.getByText('继续 00:33')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('打开老友记第1季第24集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/material', params: { id: 'friends-s01e24' } });
  await fireEvent.press(view.getByLabelText('选择第2季'));
  expect(view.getByLabelText('选择第2季').props.accessibilityState.selected).toBe(true);
  expect(view.queryByLabelText('打开老友记第1季第24集')).toBeNull();
  await fireEvent.press(view.getByLabelText('打开老友记第2季第3集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/material', params: { id: 'friends-s02e03' } });
  await view.unmount();
});

it('尚未加载的目录不误报为空，未知剧名加载后给出空提示', async () => {
  mockParams = { series: 'missing' };
  const current = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...current, materials: [], loading: true });
  const view = await render(<SpeakingSeriesScreen />);
  expect(view.queryByText('这部电视剧暂时没有可用剧集。')).toBeNull();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...current, materials: [] });
  await view.rerender(<SpeakingSeriesScreen />);
  expect(view.getByText('这部电视剧暂时没有可用剧集。')).toBeTruthy();
  await view.unmount();
});

it('播客更多按节目展示并打开选集页', async () => {
  mockParams = { section: '播客' };
  const current = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  const podcasts = [material('joe-rogan-experience-2219', '乔·罗根访谈 · 特朗普', '播客'),
    material('joe-rogan-experience-2404', '乔·罗根访谈 · 马斯克', '播客')];
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...current, materials: [...materials, ...podcasts] });
  const view = await render(<SpeakingSectionScreen />);
  expect(view.getByText('播客 共 1 档播客')).toBeTruthy();
  expect(view.queryByLabelText('打开乔·罗根访谈 · 马斯克')).toBeNull();
  await fireEvent.press(view.getByLabelText('打开乔·罗根访谈选集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/podcast', params: { podcast: 'joe-rogan-experience' } });
  await view.unmount();
});
