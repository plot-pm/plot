import {
  hostFixture,
  hostShell,
  planStoreFixture,
  planStoreShell,
  prIndexFile,
  refsFixture,
  refsGit,
  defaultBranchFile,
} from '@plot-pm/domain/adapters';
import type { Host, PlanStore, Refs } from '@plot-pm/domain';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';

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
   * The checkout's record of what the host last said about its PRs.
   *
   * Added when `deliverabilityOf` was migrated to read it first: a branch the
   * store answers from a `MERGED` row costs the host nothing, so the port
   * travels beside `host` for the same reason that one does.
   */
  prIndex: PrIndexStore;
  /**
   * The default branch's CI reading, fleetd's own file.
   *
   * Travels beside `prIndex` for the same reason: a mock board gets a
   * FIXTURE store rather than a real file, and the port is the seam that
   * makes the swap invisible to whatever reads it.
   */
  defaultBranch: DefaultBranchStore;
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
    prIndex: prIndexFile({ cwd: opts.repoRoot }),
    defaultBranch: defaultBranchFile(opts.repoRoot),
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
    // No store to read, which per the port's own contract means ask the host
    // for everything — exactly what a mock board, which never ran a refresh,
    // should do.
    prIndex: {
      location: async () => ({ ok: true, value: '' }),
      read: async () => ({ ok: true, value: null }),
      write: async () => ({ ok: true, value: undefined }),
    },
    // No reading, which `defaultBranchStatus` already treats as "not red" —
    // a mock board never ran fleetd and has nothing to report.
    defaultBranch: {
      read: async () => ({ ok: true, value: null }),
      write: async () => ({ ok: true, value: undefined }),
    },
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
