import { planStatusCounts, type PlanStatusCounts } from './plan-status-counts.js';
import type { PlanStatus } from './phase.js';

/**
 * The sprint line's own item counts: `6 done · 2 WIP · 1 open`, counted from
 * the sprint's items only.
 *
 * Takes the sprint's own member statuses and nothing else — a caller passing
 * the estate instead would get the estate's counts back, which is the mistake
 * this rule's name and signature both resist: there is no estate parameter to
 * reach for.
 *
 * @param memberStatuses - the statuses of the sprint's own non-deferred members.
 * @returns the four-bucket tally over those members.
 */
export const sprintLineCounts = (memberStatuses: readonly PlanStatus[]): PlanStatusCounts =>
  planStatusCounts(memberStatuses);
