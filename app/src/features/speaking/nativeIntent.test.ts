import { redirectSystemPath } from '@/app/+native-intent';
it('routes system shares to the import screen without including file locations', () => {
  expect(redirectSystemPath({ path: 'app://expo-sharing', initial: true })).toMatch(/^\/speaking\/import\?source=shared&share=\d+$/u);
  expect(redirectSystemPath({ path: 'app://expo-sharing', initial: false })).toMatch(/^\/speaking\/import\?source=shared&share=\d+$/u);
  expect(redirectSystemPath({ path: 'app://login', initial: true })).toBe('app://login');
  expect(redirectSystemPath({ path: '/speaking/edit?id=file', initial: false })).toBe('/speaking/edit?id=file');
});
