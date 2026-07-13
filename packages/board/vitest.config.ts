import { defineConfig } from 'vitest/config';

// Integration + unit tests that complement the node:test artifact suite
// (test/*.test.mjs, run via `pnpm test`). Vitest owns the tiny-garden
// integration tests: a data layer that spawns the built artifact and a UI layer
// that drives a real browser (Playwright) against it. Kept in test/{unit,integration}
// so vitest never picks up the node:test files at test/*.test.mjs.
export default defineConfig({
  test: {
    include: ['test/{unit,integration}/**/*.test.ts'],
    environment: 'node',
    // The UI layer boots a server and launches Chromium — generous timeouts,
    // and no cross-file parallelism so server spawns don't contend.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
