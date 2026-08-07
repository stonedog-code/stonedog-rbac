/** @type {import('jest').Config} */
module.exports = {
  // ESM rather than the default CommonJS transform, matching the source this
  // package ships. Requires NODE_OPTIONS=--experimental-vm-modules, set in the
  // `test` script.
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**", "!src/index.ts"],
  // An authorisation evaluator: the uncovered branch is, by construction, a
  // path that either grants or denies something. The package is small enough
  // that there is no excuse for a gap.
  coverageThreshold: {
    global: { statements: 95, branches: 95, functions: 95, lines: 95 },
  },
};
