import { answered, type PortResult } from '../../port-result.js';
import type { SliceRefusal, RefusedSliceRecord } from '../../ports/refused-slices.js';

/** An in-memory {@link RefusedSliceRecord}, with the branches it holds exposed for assertions. */
export interface RefusedSlicesFixture extends RefusedSliceRecord {
  /** The branches recorded so far, in first-record order. */
  readonly branches: readonly string[];
  /** The refusal detail recorded per branch. */
  readonly refusals: ReadonlyMap<string, SliceRefusal>;
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
  const refusals = new Map<string, SliceRefusal>();
  return {
    branches,
    refusals,
    refusal: async (branch: string): Promise<PortResult<SliceRefusal | null>> =>
      answered(branches.includes(branch) ? (refusals.get(branch) ?? { session: '', reason: '', at: '' }) : null),
    has: async (branch: string): Promise<PortResult<boolean>> => answered(branches.includes(branch)),
    record: async (branch, detail): Promise<PortResult<void>> => {
      if (branch !== '' && !branches.includes(branch)) {
        branches.push(branch);
        if (detail !== undefined) refusals.set(branch, { ...detail, at: '2026-01-01T00:00:00.000Z' });
      }
      return answered(undefined);
    },
  };
};
