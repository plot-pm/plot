import { defineConfig } from 'vitest/config';

/**
 * THE CORPUS TIER, AND IT IS A SEPARATE CONFIG BECAUSE IT IS A SEPARATE JOB.
 *
 * `vitest.config.ts` includes `test/**` and gates coverage at 100%. Neither
 * suits this tier, and the reasons are different for each half:
 *
 * COVERAGE IS NOT GATED HERE, and deliberately. The default config excludes
 * `src/adapters/**` from its threshold because an adapter's uncovered branches
 * are the ones needing a host to fail, a disk to be full, or a process to die
 * at the wrong moment — and a threshold forcing those to be faked teaches
 * people to fake them. These tests exercise the adapters against the live
 * estate, but they are not there to move a number; what protects that directory
 * is the purity-except-adapters grep and this comparison, and neither is a
 * percentage.
 *
 * THE TIMEOUT IS THE MEASUREMENT. `plot-fleet-scan.sh` takes ~21 s against this
 * estate and the pulse comparison runs it twice — once as production, once
 * through the adapter — so the default 5 s fails on a correct adapter. Ten
 * minutes is the same bound `runProcess` gives the pulse, and it turns a wedged
 * scan into a failure rather than a job that sits in `in_progress` looking like
 * work.
 *
 * IT RUNS AS ITS OWN CI JOB, PARALLEL TO THE REST. The board's integration
 * suite ran 12.5 minutes on 2026-08-29 and has timed out at 15; folding a tier
 * that spawns the scan twice and the parser over 172 plans into a job already
 * at its budget would make an unrelated suite fail for reasons that have
 * nothing to do with the code under test. Separated, the two signals stay
 * readable: a red validate job means the board, a red corpus job means the
 * adapters and production disagree.
 */
export default defineConfig({
  test: {
    include: ['corpus/**/*.corpus.test.ts'],
    // The scan is ~21 s and this tier runs it twice; the default would clip a
    // correct adapter.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // ONE FILE AT A TIME. Both files spawn the fleet scan, which walks every
    // ref in the repository — running them concurrently doubles that walk on
    // one runner and makes each side's timing a function of the other's.
    fileParallelism: false,
  },
});
