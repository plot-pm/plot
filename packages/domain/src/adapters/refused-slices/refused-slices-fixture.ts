import { answered, type PortResult } from '../../port-result.js';
import type { RefusedSliceRecord } from '../../ports/refused-slices.js';

/** An in-memory {@link RefusedSliceRecord}, with the branches it holds exposed for assertions. */
export interface RefusedSlicesFixture extends RefusedSliceRecord {
  /** The branches recorded so far, in first-record order. */
  readonly branches: readonly string[];
}

/**
 * An in-memory refused-slice record for tests: a set of branches, starting
 * with `initial`. An empty branch is never recorded, as the file adapter
 * writes none.
 *
 * @param initial - the branches the record holds before the test acts.
 * @returns the record and the branches it holds.
 */
export const refusedSlicesFixture = (initial: readonly string[] = []): RefusedSlicesFixture => {
  const branches: string[] = [...initial];
  return {
    branches,
    has: async (branch: string): Promise<PortResult<boolean>> => answered(branches.includes(branch)),
    record: async (branch: string): Promise<PortResult<void>> => {
      if (branch !== '' && !branches.includes(branch)) branches.push(branch);
      return answered(undefined);
    },
  };
};
