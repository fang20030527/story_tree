import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { EditorialImage } from './EditorialImage';

jest.mock('expo-image', () => ({
  Image: (props: object) =>
    require('react').createElement('mock-expo-image', props),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

it('retries an unavailable remote image while keeping its overlay usable', async () => {
  jest.useFakeTimers();
  const view = await render(
    <EditorialImage uri="https://images.example.test/missing.jpg">
      <Text>加入书架</Text>
    </EditorialImage>,
  );
  expect(view.getByTestId('editorial-image').props.cachePolicy).toBe('memory-disk');
  for (const delay of [2_000, 6_000, 15_000, 30_000, 45_000]) {
    await fireEvent(view.getByTestId('editorial-image'), 'error');
    expect(view.getByText('加入书架')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(delay); });
    expect(view.getByTestId('editorial-image')).toBeTruthy();
  }
  await fireEvent(view.getByTestId('editorial-image'), 'error');
  expect(view.queryByTestId('editorial-image')).toBeNull();
  expect(view.getByText('加入书架')).toBeTruthy();
  jest.useRealTimers();
});

it('preserves the original fit and accessible name for inline artwork', async () => {
  const view = await render(
    <EditorialImage uri="https://images.example.test/artwork.webp" contentFit="contain"
      priority="low" accessibilityLabel="原刊配图" style={{ aspectRatio: 2 }} />,
  );
  const image = view.getByLabelText('原刊配图');
  expect(image.props.contentFit).toBe('contain');
  expect(image.props.priority).toBe('low');
  expect(image.props.cachePolicy).toBe('memory-disk');
});
