import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { LearningModeProvider, useLearningMode } from './LearningModeContext';

function Probe() {
  const { mode, setMode } = useLearningMode();
  return <Pressable accessibilityLabel="选择口语" onPress={() => setMode('speak')}><Text>{mode}</Text></Pressable>;
}
beforeEach(async () => { await AsyncStorage.clear(); });
it('persists mode selection and restores it when the app reopens', async () => {
  const view = await render(<LearningModeProvider><Probe /></LearningModeProvider>);
  await fireEvent.press(view.getByLabelText('选择口语'));
  expect(view.getByText('speak')).toBeTruthy();
  await waitFor(async () => expect(await AsyncStorage.getItem('@black-hole/learning-mode:v1')).toBe('speak'));
  await view.unmount();
  const restored = await render(<LearningModeProvider><Probe /></LearningModeProvider>);
  await waitFor(() => expect(restored.getByText('speak')).toBeTruthy());
});
it('does not let delayed storage hydration override a user selection', async () => {
  let resolve: (value: string) => void = () => undefined;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  const view = await render(<LearningModeProvider><Probe /></LearningModeProvider>);
  await fireEvent.press(view.getByLabelText('选择口语'));
  await act(async () => resolve('read'));
  expect(view.getByText('speak')).toBeTruthy();
  jest.restoreAllMocks();
});
