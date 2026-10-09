import { defineConfig } from 'vitest/config';

// Unit tests for the fleet's shared modules and entries, run via `pnpm test`
// alongside the node:test artifact suite (test/*.test.mjs). Fleet takes no
// port and drives no browser — unlike the board, it has no serial project,
// so one project covers everything under test/unit.

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    /**
     * CARRIED FROM `packages/board/vitest.config.ts` WHEN ITS SUBJECTS MOVED
     * HERE. `loop-writes.ts` and `worker-loop.ts` earn the domain's pure-side
     * 100%, for the reason board's config stated before the move: every arm
     * is a `switch` case (or, for the loop, a step) calling a port whose
     * fixture answers synchronously, with no process, no port and no browser
     * of its own — the whole file is reachable from a plain call. Only
     * `worker-loop.ts`'s run-as-a-process guard at its foot is excluded, by
     * an annotation that says why.
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
