import { defineConfig } from 'vitest/config';

// Integration + unit tests that complement the node:test artifact suite
// (test/*.test.mjs, run via `pnpm test`). Vitest owns the tiny-garden
// integration tests: a data layer that spawns the built artifact and a UI layer
// that drives a real browser (Playwright) against it. Kept in test/{unit,integration}
// so vitest never picks up the node:test files at test/*.test.mjs.
//
// TWO PROJECTS, KEYED ON THE CONTENDED RESOURCE — not on the directory and not
// on the filename. A single config made all 70 files take the stricter of the
// two parallelisms, and the comment's reason ("boots a server and launches
// Chromium") was true of the serial group and not of the rest.
//
// There are exactly two contended resources, a port and a Chromium process, and
// the split is on whether a file takes EITHER:
//
//   parallel — takes neither: test/unit. Measured, zero of its files mention
//              `chromium` or `startServer`, and
//              `parallel-project-takes-no-resource.test.ts` is the gate that
//              keeps it that way rather than leaving it to this comment.
//   serial   — takes either: test/integration. Most files take both, four take
//              Chromium alone, and three (`tiny-garden.data|plan|story`) take a
//              port alone.
//
// Counts are deliberately not written here. They moved twice while this change
// was being made (main landed files mid-branch), and a comment carrying a stale
// count is how a reader concludes the rule is wrong when only the tally is.
//
// The directory name is wrong about several files in both directions —
// three named `.browser.` start no server, and three not named `.browser.` do —
// so `test/unit` vs `test/integration` would put files in the group they do not
// need and imply the folder means something it does not. `test/unit` is the
// parallel project because every file in it takes neither resource, which is a
// measured property and is asserted below rather than assumed.
//
// The Chromium-without-server files are NOT a third, port-free project.
// Chromium is itself contended and nothing here has measured how many instances
// this machine tolerates; a third project would need a concurrency number, and
// an unmeasured number is the next unfounded figure.
//
// `fileParallelism` is honoured per project — verified by timestamping file
// starts, not by reading the vitest 4 types, which declare the option on the
// root config next to `projects` and so read like a global a project cannot
// override: three files in a parallel probe project all started at +0 ms and
// ended together, three in a serial one started 1.3 s apart. Vitest also runs
// the projects one after another, so the serial project never contends with the
// parallel one.
//
// Measured 2026-08-20 on the parallel project alone, only
// --fileParallelism differing: 91.0 s serial against 35.5 s parallel, with
// vitest's own `tests 191.4 s` compressed into that 35.5 s of wall clock. The
// machine was NOT idle (sibling agents running), so treat the ratio as the
// finding and the absolute numbers as conditional — the plan's open point about
// re-measuring idle is still open.
//
// The full `vitest run` moves much less, 779 s to 750 s, because the serial
// project is 700 s of it. That is the number to quote for this change: it makes
// the non-browser half cheap to re-run, and does not claim to shorten the
// browser half.
const testTimeout = 30_000;
const hookTimeout = 30_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // Takes neither a port nor a browser.
          name: 'parallel',
          include: ['test/unit/**/*.test.ts'],
          testTimeout,
          hookTimeout,
          fileParallelism: true,
        },
      },
      {
        test: {
          // Takes a port, a browser, or both. Generous timeouts, and no
          // cross-file parallelism so neither resource is contended.
          name: 'serial',
          include: ['test/integration/**/*.test.ts'],
          testTimeout,
          hookTimeout,
          fileParallelism: false,
        },
      },
    ],
  },
});
