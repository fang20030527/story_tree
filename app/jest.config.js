module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/src/**/*.test.[jt]s?(x)'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@context-reader/contracts$':
      '<rootDir>/../packages/contracts/src/index.ts',
  },
};
