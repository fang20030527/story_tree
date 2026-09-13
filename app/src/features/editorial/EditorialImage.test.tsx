import { fireEvent, render } from '@testing-library/react-native';
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

it('keeps overlay content usable when the remote image fails', async () => {
  const view = await render(
    <EditorialImage uri="https://images.example.test/missing.jpg">
      <Text>加入书架</Text>
    </EditorialImage>,
  );
  await fireEvent(view.getByTestId('editorial-image'), 'error');
  expect(view.queryByTestId('editorial-image')).toBeNull();
  expect(view.getByText('加入书架')).toBeTruthy();
});
