import { render } from '@testing-library/react-native';
import React from 'react';

import FavoritesScreen from '@/app/favorites';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) =>
    require('react').createElement('redirect', { href, testID: 'redirect' }),
}));

it('redirects legacy favorite links to the semantic shelf', async () => {
  const view = await render(<FavoritesScreen />);
  expect(view.getByTestId('redirect').props.href).toBe('/shelf');
});
