module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@context-reader/contracts$':
      '<rootDir>/../packages/contracts/src/index.ts',
  },
};
