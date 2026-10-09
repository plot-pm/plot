import { defineConfig } from 'vitest/config';

// Unit tests for the fleet's shared modules and entries. `pnpm test` runs
// them after the node:test bundle suite (test/*.test.mjs). The fleet binds no
// port and drives no browser, so one project covers test/unit.

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    /**
     * A GATE: 100% for `loop-writes.ts` and `worker-loop.ts`. Every arm is a
     * `switch` case or a loop step that calls a port whose fixture answers
     * synchronously, with no process, no port and no browser of its own, so
     * the whole file is reachable from a plain call. An annotation excludes
     * only `worker-loop.ts`'s run-as-a-process guard at its foot.
     */
    coverage: {
      provider: 'v8',
      all: false,
      include: ['src/server/entry/loop-writes.ts', 'src/server/entry/worker-loop.ts'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
