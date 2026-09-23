import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { PracticeDto } from '@context-reader/contracts';

import { getDashboard, getPractice } from '@/api/practices';
import { loadActivePracticeId } from './practiceStorage';
import { ContinuePracticeCard } from './ContinuePracticeCard';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('@/api/practices', () => ({ getPractice: jest.fn(), getDashboard: jest.fn() }));
jest.mock('./practiceStorage', () => ({ loadActivePracticeId: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));
const id = '11111111-1111-4111-8111-111111111111';
const practice: PracticeDto = {
  id, status: 'completed', modelName: null, remainingFreePractices: 2, failure: null, article: null, questions: [],
  group: { id, canRetryFailed: false, articles: (['经济', '文化', '政治', '科技'] as const).map((topic, index) => ({
    id, topic, status: index === 0 ? 'completed' : 'ready', generationProgress: 100, title: topic, wordCount: 250, failureMessage: null,
  })) },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadActivePracticeId).mockResolvedValue(id);
  jest.mocked(getPractice).mockResolvedValue(practice);
});
it('resumes a group even after its first article has been completed', async () => {
  const view = await render(<ContinuePracticeCard />);
  await fireEvent.press(await view.findByText('继续主题短文'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/practice/[id]/topics', params: { id } });
});
it('hides finished groups', async () => {
  jest.mocked(getPractice).mockResolvedValue({ ...practice, group: {
    id, canRetryFailed: false, articles: practice.group!.articles.map((article) => ({ ...article, status: 'completed' })),
  } });
  const view = await render(<ContinuePracticeCard />);
  await waitFor(() => expect(getPractice).toHaveBeenCalled());
  expect(view.queryByText('继续主题短文')).toBeNull();
});
it('restores a single practice at its next unanswered question', async () => {
  jest.mocked(getPractice).mockResolvedValue({ ...practice, status: 'in_progress', group: undefined,
    questions: [{ submittedAnswer: { answerKind: 'dont_know' } }] as PracticeDto['questions'],
  });
  const view = await render(<ContinuePracticeCard />);
  await fireEvent.press(await view.findByText('继续练习'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/practice/[id]/quiz', params: { id } });
});
it('restores a single practice that was interrupted during reading', async () => {
  jest.mocked(getPractice).mockResolvedValue({ ...practice, status: 'ready', group: undefined });
  const view = await render(<ContinuePracticeCard />);
  await fireEvent.press(await view.findByText('继续练习'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/practice/[id]/read', params: { id } });
});

it('falls back to the server entry when the local practice is already finished', async () => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  jest.mocked(getPractice).mockResolvedValueOnce({ ...practice, group: undefined })
    .mockResolvedValueOnce({ ...practice, id: otherId, status: 'ready', group: undefined });
  jest.mocked(getDashboard).mockResolvedValue({ incompletePracticeId: otherId } as Awaited<ReturnType<typeof getDashboard>>);
  const view = await render(<ContinuePracticeCard />);
  await fireEvent.press(await view.findByText('继续练习'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/practice/[id]/read', params: { id: otherId } });
});
