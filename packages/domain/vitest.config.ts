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
 * nothing. The domain has no such excuse — the purity boundary guarantees every
 * line is reachable from a plain function call, so an uncovered line is a line
 * nobody specified.
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
      //
      // ADAPTERS ARE EXCLUDED, AND THE THRESHOLD IS WHY. 100% is defensible for
      // the pure side precisely because the purity boundary makes every line
      // reachable from a plain function call — an adapter has no such
      // guarantee. Its uncovered branches are the ones that need a host to
      // fail, a disk to be full, or a process to die at the wrong moment, and a
      // threshold that forces those to be faked teaches people to fake them.
      //
      // What protects this directory instead is the purity-except-adapters
      // grep, which confines every world-reaching import to it, and the corpus
      // tests, which run the adapters against the live estate and compare their
      // readings with production's. Neither is a coverage number, and both fail
      // on something real.
      exclude: ['src/index.ts', 'src/adapters/**'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
