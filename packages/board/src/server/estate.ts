import {
  hostFixture,
  hostShell,
  planStoreFixture,
  planStoreShell,
  refsFixture,
  refsGit,
} from '@plot-pm/domain/adapters';
import type { Host, PlanStore, Refs } from '@plot-pm/domain';

import type { EstateSource } from './controllers/fleet-state.js';
import { realEstateSource } from './controllers/fleet-state.js';
import { mockCards, mockFleet, mockPlans, mockPulse, mockRequested } from './mock-fleet.js';

/**
 * The driven side, as one process holds it.
 *
 * The two ports this slice owns. The other five are constructed where their
 * callers are migrated; a composition root naming ports nothing yet asks would
 * be a promise rather than a wiring.
 */
export interface Estate {
  planStore: PlanStore;
  refs: Refs;
  /**
   * The git host, for the questions only it can answer.
   *
   * Added when `deliverabilityOf` was migrated: that controller asks whether a
   * branch merged, and a controller may not spawn to find out. It is on the
   * estate rather than constructed at the call site so the mock board gets a
   * FIXTURE — `hostShell` runs `plot-host.sh`, and a mock that spawned would
   * not be one.
   */
  host: Host;
  /**
   * The same estate in the shape the synchronous board still reads it.
   *
   * It travels WITH the ports rather than beside them because it answers about
   * the same world: a process holding fixture ports and a real estate source
   * would serve two different estates through one board, which is the exact
   * confusion `mockFleet` refuses when it replaces the payload rather than
   * merging into it.
   */
  source: EstateSource;
}

/** Where the shell adapters find the repository and the helper scripts. */
export interface EstateOptions {
  repoRoot: string;
  scriptsDir: string;
}

/**
 * The estate as it really is: plans through `plot-plan-meta.sh`, refs through
 * git and the fleet scan.
 *
 * @param opts - where the repository and the scripts are.
 * @returns adapters backed by this machine.
 */
export const realEstate = (opts: EstateOptions): Estate => {
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  return {
    planStore: planStoreShell(context),
    refs: refsGit(context),
    host: hostShell(context),
    source: realEstateSource,
  };
};

/**
 * The estate the mock board serves: fixtures behind the same ports.
 *
 * Built from `mock-fleet.ts`'s data, so the mock has ONE definition and the
 * adapters are a second way to reach it rather than a second copy of it.
 *
 * It takes no options and reads no environment. Everything it answers was
 * decided when it was constructed, which is what makes it usable from a test
 * that holds no repository.
 *
 * @returns adapters backed by fixtures.
 */
export const mockEstate = (): Estate => {
  const plans = mockPlans();
  return {
    planStore: planStoreFixture({ plans }),
    refs: refsFixture({
      defaultBranch: 'main',
      branches: plans.flatMap((plan) => [...plan.branches]),
      pulse: mockPulse(),
    }),
    // Every branch the mock's plans name reads as merged: the mock estate is a
    // finished one, and a fixture knows its own world rather than guessing at it.
    host: hostFixture({ merged: plans.flatMap((plan) => [...plan.branches]) }),
    // `fleet` answers a resolved promise because the port made the real one
    // awaited; the fixture reads nothing and waits for nothing, which is
    // exactly what a caller cannot tell from the outside.
    source: { columns: () => mockCards(), fleet: async () => mockFleet() },
  };
};

/**
 * Chooses the estate this process serves, reading `PLOT_BOARD_MOCK` ONCE.
 *
 * **This is the only place the variable decides anything.** Everything above
 * the ports takes the estate it was given and cannot tell which it holds —
 * which is what lets a mock board serve a real controller with no controller
 * code mentioning a mock.
 *
 * The variable stays one global per process, and that is a known limit: two
 * *servers* still cannot differ. What this buys is an escape from it — a
 * caller that constructs {@link mockEstate} or {@link realEstate} directly
 * holds exactly the estate it built, whatever the variable says.
 *
 * @param opts - where the repository and the scripts are.
 * @param env - the environment to read; defaults to this process's.
 * @returns the mock estate when explicitly asked for, the real one otherwise.
 */
export const estateFromEnv = (
  opts: EstateOptions,
  env: NodeJS.ProcessEnv = process.env,
): Estate => (mockRequested(env) ? mockEstate() : realEstate(opts));
