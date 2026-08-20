import { defineConfig } from 'vitest/config';

// Integration + unit tests that complement the node:test artifact suite
// (test/*.test.mjs, run via `pnpm test`). Vitest owns the tiny-garden
// integration tests: a data layer that spawns the built artifact and a UI layer
// that drives a real browser (Playwright) against it. Kept in test/{unit,integration}
// so vitest never picks up the node:test files at test/*.test.mjs.
//
// Two projects, because the two halves need different parallelism and a single
// config makes the whole suite take the stricter of the two. Measured 2026-08-20
// on the 51 non-browser files as their own project, only --fileParallelism
// differing: 91.0 s serial, 35.5 s parallel (-61%), with vitest's own
// `tests 191.4 s` compressed into that 35.5 s of wall clock. They were serial
// only because they shared a config with the browser files.
//
// The full `vitest run` moves much less — 779 s to 750 s — because the 20 serial
// browser files dominate the total. The -61% is the number that describes this
// change; anyone quoting a whole-suite figure is measuring the browser tail.
//
// `fileParallelism` is honoured per project — verified by timestamping file
// starts, not by reading the types, which declare it on the root config: three
// files in a parallel project all start at +0 ms, three in a serial project
// start 1.3 s apart. Vitest also runs the projects one after another, so the
// browser project never contends with the parallel one.
const testTimeout = 30_000;
const hookTimeout = 30_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // Everything that spawns no browser. The three tiny-garden data-layer
          // files do spawn the built artifact, but the server binds PORT=0 and
          // the OS assigns during its own listen(), so concurrent spawns cannot
          // contend for a port — the Chromium launch is the cost that had to
          // stay serial, not the server.
          include: ['test/{unit,integration}/**/*.test.ts'],
          exclude: ['test/integration/**/*.browser.test.ts'],
          testTimeout,
          hookTimeout,
          fileParallelism: true,
        },
      },
      {
        test: {
          name: 'browser',
          // The UI layer boots a server and launches Chromium — generous
          // timeouts, and no cross-file parallelism so browser launches don't
          // contend. This is the constraint the original single config applied
          // to all 71 files; here it applies only to the 20 it is about.
          include: ['test/integration/**/*.browser.test.ts'],
          testTimeout,
          hookTimeout,
          fileParallelism: false,
        },
      },
    ],
  },
});
