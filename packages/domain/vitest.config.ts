import { defineConfig } from 'vitest/config';

/**
 * COVERAGE IS A GATE HERE, NOT A REPORT.
 *
 * `thresholds` makes `vitest run --coverage` exit non-zero when unmet, so the
 * number fails a build rather than printing into a void — this repo's own
 * lesson about detection that reports and does not stop anything.
 *
 * 100% is defensible in this package and nowhere else in this repo. The board
 * cannot reach it: it spawns processes, binds ports and drives a browser, and a
 * threshold it structurally cannot meet is one that gets lowered until it means
 * nothing. The pure side of this package has no such excuse — the purity
 * boundary guarantees every line is reachable from a plain function call, so an
 * uncovered line is a line nobody specified.
 *
 * `all: true` is what makes that true of the PACKAGE rather than of the files
 * a test happened to import. Without it a module with no test at all is absent
 * from the denominator, and 100% would mean "everything I looked at" — the
 * reassuring direction, which is the worst way to be wrong.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      // Barrel files re-export and execute nothing; counting them would make
      // the number a statement about `export *` lines.
      exclude: ['src/index.ts'],
      thresholds: {
        // ADAPTERS ARE MEASURED, NOT EXCLUDED. 100% is defensible for the pure
        // side precisely because the purity boundary makes every line reachable
        // from a plain function call — an adapter has no such guarantee. Its
        // uncovered branches are the ones that need a host to fail, a disk to be
        // full, or a process to die at the wrong moment, and a threshold that
        // forces those to be faked teaches people to fake them.
        //
        // What protects that directory beyond these numbers is the
        // purity-except-adapters grep, which confines every world-reaching
        // import to it, and the corpus tests, which run the adapters against the
        // live estate and compare their readings with production's. Neither is a
        // coverage number, both fail on something real, and NEITHER IS REPLACED
        // BY WHAT FOLLOWS. These thresholds are a third, weaker protection —
        // they record what the suite reaches so a drop is visible. They do not
        // certify an adapter is tested.
        //
        // WHY THE GLOBAL NUMBERS ARE NOT 100. A glob key in vitest is ADDITIVE:
        // `resolveThresholds` builds each glob's map and then adds EVERY file to
        // the global map regardless — "Global threshold is for all files, even if
        // they are included by glob patterns" (vitest 4.1.11). So a glob cannot
        // exempt a path from the global line, and holding the global line at 100
        // while the adapters are measured would fail on the adapters' own honest
        // readings. The global entry is therefore the whole-package floor, and
        // the pure side keeps its 100% through the two explicit globs below.
        //
        // Measured whole-package: 95.31 lines / 82.80 branches / 89.23 functions
        // / 94.00 statements.
        lines: 90,
        branches: 77,
        functions: 84,
        statements: 89,

        // THE PURE SIDE KEEPS 100%, STATED AS TWO GLOBS BECAUSE ONE CANNOT SAY
        // IT. `src/!(adapters)/**/*.ts` matches nothing at the top level of
        // `src`, which would have dropped `src/port-result.ts` out of the gate
        // silently — a file passing because nothing asked about it. The second
        // glob names that level explicitly. `src/index.ts` is excluded above and
        // so is in neither.
        'src/!(adapters)/**/*.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/*.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },

        // Each entry below names ONE path and the reason its number is not 100.
        //
        // THE NUMBERS ARE MEASURED, NOT CHOSEN. Taken 2026-08-30 and reproduced
        // 2026-08-31 by running the existing suites with the old blanket
        // exclusion lifted — no adapter test was written to reach them; four
        // test files were already exercising these paths into a report nobody
        // could see. Each threshold is the measured figure rounded DOWN, leaving
        // roughly five points of margin (less where the reading is already at or
        // near zero, where five points is not even one branch). The margin is
        // deliberate: a threshold pinned to today's exact reading goes red on the
        // next honest refactor, and a gate that fails on unrelated work gets
        // deleted rather than met.
        //
        // These are a RATCHET FLOOR, not a target. Raise an entry when real
        // tests raise the reading; never raise one to set a goal.

        // Takes a command and returns what the process wrote, so its own
        // branches are reachable from a plain test. The gap is the failure paths
        // of a process that did not fail during the run.
        // Measured: 100 lines / 85 branches / 100 functions / 100 statements.
        'src/adapters/run-script.ts': { lines: 95, branches: 80, functions: 95, statements: 95 },

        // Reads load and process tables from the live machine. The uncovered
        // line is the branch taken when the OS reports a shape this machine did
        // not produce during the run.
        // Measured: 100 lines / 85.71 branches / 100 functions / 93.33 statements.
        'src/adapters/machine/**': { lines: 95, branches: 80, functions: 95, statements: 88 },

        // Reads plan files from disk. Covered on the happy path; the uncovered
        // half of its branches are malformed-file and unreadable-path cases that
        // need a disk arranged to fail.
        // Measured: 100 lines / 50 branches / 100 functions / 90.91 statements.
        'src/adapters/plan-store/**': { lines: 95, branches: 45, functions: 95, statements: 85 },

        // Shells out to git for worktree state. The gap is git failing, or
        // reporting a tree shape the estate did not contain during the run.
        // Measured: 89.66 lines / 72.22 branches / 87.50 functions / 87.50 statements.
        //
        // THE NUMBERS BELOW ARE CI'S, NOT A DEV MACHINE'S, AND THEY DIFFER.
        // Measured 2026-08-31 on one commit: `refs` functions 75 locally vs
        // 66.66 on CI; `trees` branches 72.22 vs 61.11. A threshold set from a
        // local run passes locally and fails the build. Where the two disagree,
        // take CI's — it is the one that gates. (Not the git host: stubbing
        // `gh` to exit 3 reproduced the LOCAL numbers exactly, so the cause is
        // the platform, not the host's absence.)
        'src/adapters/trees/**': { lines: 84, branches: 58, functions: 82, statements: 82 },

        // Observes processes it did not start. Its uncovered branches need a
        // process to die at a specific moment — the case this file's warning is
        // named after, and the one most likely to be faked if forced.
        // Measured: 73.68 lines / 58.33 branches / 66.67 functions / 70 statements.
        'src/adapters/processes/**': { lines: 68, branches: 53, functions: 61, statements: 65 },

        // Shells out to git for ref state. The gap is git failing, or refs in
        // states the local estate did not hold during the run.
        // Measured: 72.73 lines / 40 branches / 75 functions / 65.52 statements.
        'src/adapters/refs/**': { lines: 67, branches: 35, functions: 63, statements: 60 },

        // THE LOWEST ENTRY, AND KNOWN TO BE SO. Talks to the git host CLI, so
        // most of its branches need a host to answer — or to fail — in ways a
        // test run cannot arrange. Raising this is the Covering slice's job, and
        // this floor exists so that slice has a start rather than an assumption.
        // Measured: 63.89 lines / 12.24 branches / 35.29 functions / 57.50 statements.
        'src/adapters/host/**': { lines: 58, branches: 10, functions: 30, statements: 52 },

        // Returns the wall clock. Its branches are zero-covered because there is
        // one honest way to cover them — inject the clock — and doing that is the
        // Covering slice's job. A branches floor of 0 is the TRUE reading, stated
        // rather than assumed, which is the whole point of naming it here.
        // Measured: 50 lines / 0 branches / 33.33 functions / 50 statements.
        'src/adapters/clock/**': { lines: 45, branches: 0, functions: 30, statements: 45 },
      },
    },
  },
});
