import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { SpeakingHomeScreen } from './SpeakingHomeScreen';
import { SpeakingSectionScreen } from './SpeakingSectionScreen';
import { SpeakingPodcastScreen } from './SpeakingPodcastScreen';
import { useSpeakingLibrary } from './useSpeakingLibrary';

let mockParams: { section?: string; query?: string; podcast?: string } = {};
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

function material(id: string, title: string, category = '播客'): SpeakingMaterial {
  return { id, title, category, subtitle: '', origin: 'platform', mediaType: 'video', duration: 7_200, cues: [], cueCount: 100 };
}
const joe = [material('joe-rogan-experience-2219', '乔·罗根访谈 · #2219 特朗普'),
  material('joe-rogan-experience-2404', '乔·罗根访谈 · #2404 马斯克'),
  material('joe-rogan-experience-2422', '乔·罗根访谈 · #2422 黄仁勋')];
const ceo = ['ai-experts-debate', 'andy-galpin', 'rick-rubin', 'shawn-ryan', 'adam-neumann']
  .map(guest => material(`the-diary-of-a-ceo-${guest}`, `CEO 日记 · ${guest}`));
const iced = ['togi', 'billionaire', 'jordan-peterson', 'mike-rowe', 'thestradman']
  .map(guest => material(`the-iced-coffee-hour-${guest}`, `冰咖啡时刻 · ${guest}`));
const materials = [material('steve-jobs-stanford-2005', '斯蒂夫·乔布斯', '演讲片段'), ...joe, ...ceo, ...iced];

beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  const store = emptySpeakingStore(); store.positions[joe[2]!.id] = 33;
  jest.mocked(useSpeakingLibrary).mockReturnValue({ materials, store, scope: 'speaking:v1:guest', cloud: false,
    loading: false, error: '', catalogError: '', loadingMore: false, moreError: '', hasMore: false,
    loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
});

it('主页展示三个节目总名和期数，节目入口进入选集、更多进入栏目', async () => {
  const view = await render(<SpeakingHomeScreen />);
  for (const episode of joe) expect(view.queryByText(episode.title)).toBeNull();
  expect(view.getByText('乔·罗根访谈')).toBeTruthy();
  expect(view.getByText('共 3 期')).toBeTruthy();
  expect(view.getAllByText('共 5 期')).toHaveLength(2);
  await fireEvent.press(view.getByLabelText('打开冰咖啡时刻选集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/podcast', params: { podcast: 'the-iced-coffee-hour' } });
  await fireEvent.press(view.getByLabelText('查看更多播客素材'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/section', params: { section: '播客' } });
  await fireEvent.press(view.getByLabelText('查找跟读素材'));
  await fireEvent.changeText(view.getByLabelText('搜索跟读素材'), '黄仁勋');
  expect(view.getByLabelText('打开乔·罗根访谈选集')).toBeTruthy();
  expect(view.getByText('共 3 期')).toBeTruthy();
  expect(view.queryByLabelText('打开冰咖啡时刻选集')).toBeNull();
  await view.unmount();
});

it('更多只列节目，搜索嘉宾后仍从完整节目进入选集', async () => {
  mockParams = { section: '播客' };
  const view = await render(<SpeakingSectionScreen />);
  expect(view.getByText('播客 共 3 档播客')).toBeTruthy();
  expect(view.queryByLabelText(`打开${joe[2]!.title}`)).toBeNull();
  await fireEvent.changeText(view.getByLabelText('搜索播客'), '#2422');
  expect(view.getByText('共 3 期')).toBeTruthy();
  expect(view.queryByLabelText('打开CEO 日记选集')).toBeNull();
  await fireEvent.press(view.getByLabelText('打开乔·罗根访谈选集'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/podcast', params: { podcast: 'joe-rogan-experience' } });
  await view.unmount();
});

it('选集只展示对应节目，保留进度并打开所选单集', async () => {
  mockParams = { podcast: 'joe-rogan-experience' };
  const view = await render(<SpeakingPodcastScreen />);
  expect(view.getByText('共 3 期')).toBeTruthy();
  for (const episode of joe) expect(view.getByLabelText(`打开${episode.title}`)).toBeTruthy();
  expect(view.queryByText(ceo[0]!.title)).toBeNull();
  expect(view.getByText(/继续 00:33/)).toBeTruthy();
  await fireEvent.press(view.getByLabelText(`打开${joe[2]!.title}`));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/speaking/material', params: { id: joe[2]!.id } });
  await fireEvent.changeText(view.getByLabelText('搜索播客单集'), '黄仁勋');
  expect(view.queryByLabelText(`打开${joe[0]!.title}`)).toBeNull();
  expect(view.getByLabelText(`打开${joe[2]!.title}`)).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('搜索播客单集'), '不存在');
  expect(view.getByText('没有匹配的单集，请换个关键词。')).toBeTruthy();
  mockParams = { podcast: 'the-diary-of-a-ceo' };
  await view.rerender(<SpeakingPodcastScreen />);
  expect(view.getByText('共 5 期')).toBeTruthy();
  expect(view.getByLabelText(`打开${ceo[0]!.title}`)).toBeTruthy();
  expect(view.getByLabelText('搜索播客单集').props.value).toBe('');
  await view.unmount();
});

it('目录加载时不误报为空，未知节目不展示其他节目的单集', async () => {
  mockParams = { podcast: 'missing' };
  const current = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...current, materials: [], loading: true });
  const view = await render(<SpeakingPodcastScreen />);
  expect(view.queryByText('这个节目暂时没有可用单集。')).toBeNull();
  jest.mocked(useSpeakingLibrary).mockReturnValue(current);
  await view.rerender(<SpeakingPodcastScreen />);
  expect(view.getByText('这个节目暂时没有可用单集。')).toBeTruthy();
  expect(view.queryByLabelText(`打开${joe[0]!.title}`)).toBeNull();
  await view.unmount();
});
