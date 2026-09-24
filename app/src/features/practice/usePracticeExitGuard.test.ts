import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';

import { saveActivePracticeId } from './practiceStorage';
import { usePracticeExitGuard } from './usePracticeExitGuard';

const mockDispatch = jest.fn();
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => true,
  usePreventRemove: jest.fn(),
}));
jest.mock('./practiceStorage', () => ({ saveActivePracticeId: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const action = { type: 'POP', payload: { count: 1 } };

function attemptExit() {
  const callback = jest.mocked(usePreventRemove).mock.calls.at(-1)![1];
  callback({ data: { action } });
}
function button(text: string) {
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((item) => item.text === text)!;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(saveActivePracticeId).mockResolvedValue();
});
it('cancels a swipe/back without leaving and suppresses duplicate prompts', async () => {
  await renderHook(() => usePracticeExitGuard(id, true, true));
  await act(async () => { attemptExit(); attemptExit(); });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  await act(async () => { button('继续练习').onPress!(); });
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => { attemptExit(); });
  expect(Alert.alert).toHaveBeenCalledTimes(2);
});
it('saves the resume entry before replaying the original navigation action', async () => {
  await renderHook(() => usePracticeExitGuard(id, true, true));
  let resolve!: () => void;
  jest.mocked(saveActivePracticeId).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
  await act(async () => { attemptExit(); button('保存并返回').onPress!(); });
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => { resolve(); });
  expect(saveActivePracticeId).toHaveBeenLastCalledWith(id);
  expect(mockDispatch).toHaveBeenCalledWith(action);
});
it('stays in practice when saving fails', async () => {
  await renderHook(() => usePracticeExitGuard(id, true, true));
  jest.mocked(saveActivePracticeId).mockRejectedValue(new Error('disk full'));
  await act(async () => { attemptExit(); button('保存并返回').onPress!(); });
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('保存失败', expect.any(String));
});
it('automatically saves before returning from an article without confirmation', async () => {
  await renderHook(() => usePracticeExitGuard(id));
  let resolve!: () => void;
  jest.mocked(saveActivePracticeId).mockClear();
  jest.mocked(saveActivePracticeId).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
  await act(async () => { attemptExit(); attemptExit(); });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(saveActivePracticeId).toHaveBeenCalledTimes(1);
  expect(saveActivePracticeId).toHaveBeenCalledWith(id);
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => { resolve(); });
  expect(mockDispatch).toHaveBeenCalledWith(action);
});
it('allows retrying an article exit after an automatic save fails', async () => {
  await renderHook(() => usePracticeExitGuard(id));
  jest.mocked(saveActivePracticeId).mockRejectedValueOnce(new Error('disk full'));
  await act(async () => { attemptExit(); });
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('保存失败', expect.any(String));
  jest.mocked(Alert.alert).mockClear();
  await act(async () => { attemptExit(); });
  expect(mockDispatch).toHaveBeenCalledWith(action);
  expect(Alert.alert).not.toHaveBeenCalled();
});
it('allows automatic completion with removal protection disabled', async () => {
  const { result } = await renderHook(() => usePracticeExitGuard(id));
  const complete = jest.fn(() => {
    expect(jest.mocked(usePreventRemove).mock.calls.at(-1)![0]).toBe(false);
  });
  await act(async () => { result.current(complete); });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});
