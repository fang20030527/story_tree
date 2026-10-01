import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAuthUser } from '@/features/auth/authStorage';
import { loadSpeakingStore, updateSpeakingStore } from './speakingStorage';

jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn() }));
beforeEach(async () => { await AsyncStorage.clear(); jest.mocked(loadAuthUser).mockResolvedValue(null); });
it('serializes parallel writes so note and favorite updates are not lost', async () => {
  await Promise.all([
    updateSpeakingStore(store => { store.saved.curiosity = ['cue-1']; }),
    updateSpeakingStore(store => { store.notes.curiosity = { 'cue-1': '注意停顿' }; }),
  ]);
  expect(await loadSpeakingStore()).toMatchObject({ saved: { curiosity: ['cue-1'] }, notes: { curiosity: { 'cue-1': '注意停顿' } } });
});
it('isolates guest data from registered accounts', async () => {
  await updateSpeakingStore(store => { store.positions.curiosity = 12; });
  jest.mocked(loadAuthUser).mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', kind: 'registered', remainingFreePractices: 3 });
  expect((await loadSpeakingStore()).positions).toEqual({});
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  expect((await loadSpeakingStore()).positions.curiosity).toBe(12);
});
it('does not replace corrupt data with fabricated history', async () => {
  await AsyncStorage.setItem('speaking:v1:guest', 'broken');
  await expect(loadSpeakingStore()).rejects.toThrow();
});
