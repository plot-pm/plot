import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The process census: suites that run a real command tree under `strace -f`.
// Outside the package's default `include`, so `vitest related` and the fleet's
// unit run never start it. Run it with
// `pnpm --filter @plot-pm/fleet run test:census`. The parser's unit rows
// (`*.unit.test.ts`) run in the default config instead.

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['test/census/**/*.census.test.ts'],
    globalSetup: ['test/census/census-setup.ts'],
    testTimeout: 120_000,
    // Each suite counts the processes of its own tree; parallel files would
    // load the runner the counts are measured on.
    fileParallelism: false,
  },
});
