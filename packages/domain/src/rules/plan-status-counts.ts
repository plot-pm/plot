import { z } from 'zod';

import type { PlanStatus } from './phase.js';

/**
 * The four buckets a plan's status folds into, and their sum.
 *
 * `total` always equals `open + wip + done + withdrawn` by construction — a
 * status this module does not recognise is not counted in any bucket, so an
 * unknown status shrinks `total` rather than breaking the identity.
 */
export const PlanStatusCountsSchema = z.object({
  total: z.number().int().default(0),
  open: z.number().int().default(0),
  wip: z.number().int().default(0),
  done: z.number().int().default(0),
  withdrawn: z.number().int().default(0),
});
export type PlanStatusCounts = z.infer<typeof PlanStatusCountsSchema>;

/**
 * Which bucket a {@link PlanStatus} falls into.
 *
 * Duplicates the mapping `packages/board/src/server/fleet.ts`'s `activeSprints`
 * and `estateTotals` hold over the board's own `PlanStatus` enum — declared
 * rather than accidental, per `docs/shell-and-domain.md`: the board owns the
 * host reads that produce a status, this package owns the rule two callers in
 * this wave need with no board import in reach. `released` folds into `done`
 * and `rejected`/`superseded` are already one `withdrawn` status by the time
 * {@link PlanStatus} names it.
 *
 * @param status - a plan's measured status.
 * @returns the bucket it falls into.
 */
export const bucketOf = (status: PlanStatus): 'open' | 'wip' | 'done' | 'withdrawn' => {
  switch (status) {
    case 'draft':
    case 'open':
    case 'approved':
      return 'open';
    case 'in-progress':
    case 'deliverable':
    case 'proven':
      return 'wip';
    case 'delivered':
    case 'released':
      return 'done';
    case 'withdrawn':
      return 'withdrawn';
  }
};

/**
 * Tallies a collection of plan statuses into the four buckets.
 *
 * The caller decides the scope: a sprint's own items, or the estate narrowed
 * by whatever filters are active — this rule only counts what it is given, so
 * a sprint-line total never reaches past the sprint and a filtered estate
 * total never silently widens back to the whole estate.
 *
 * @param statuses - one plan's status per plan in scope.
 * @returns the four-bucket tally, `total` equal to their sum by construction.
 */
export const planStatusCounts = (statuses: readonly PlanStatus[]): PlanStatusCounts => {
  const counts: PlanStatusCounts = { total: 0, open: 0, wip: 0, done: 0, withdrawn: 0 };
  for (const status of statuses) {
    const bucket = bucketOf(status);
    counts[bucket] += 1;
    counts.total += 1;
  }
  return counts;
};
