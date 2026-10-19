import { planStatusCounts, type PlanStatusCounts } from './plan-status-counts.js';
import type { PlanStatus } from './phase.js';

/**
 * The Delivery tab's estate totals, counted over whatever the active filters
 * leave in view.
 *
 * All four buckets are always returned — `open`, `wip`, `done` and
 * `withdrawn` — so a caller choosing to print fewer still has every count to
 * choose from; dropping one here could not be undone by the component
 * rendering it.
 *
 * @param visibleStatuses - the statuses of the plans the active filters leave visible.
 * @returns the four-bucket tally over those plans.
 */
export const filteredEstateTotals = (visibleStatuses: readonly PlanStatus[]): PlanStatusCounts =>
  planStatusCounts(visibleStatuses);
