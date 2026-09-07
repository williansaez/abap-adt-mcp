/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // ts-jest reads tsconfig.json by default, which since TypeScript 6 has
  // `types: []` and therefore no jest globals; tsconfig.test.json names them.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  // Sources import siblings with a .js suffix (NodeNext style); map back to the .ts file.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/'],
  verbose: true
};
