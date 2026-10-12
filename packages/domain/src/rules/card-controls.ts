import { z } from 'zod';

import type { PlanStatus } from './phase.js';
import { spikeOf, type SpikeSlice } from './spike.js';

/** The controls a plan card offers. Each boolean answers whether the card renders that control. */
export const CardControlsSchema = z.object({
  approve: z.boolean(),
  interrogate: z.boolean(),
  commission: z.boolean(),
  roundsBadge: z.boolean(),
  dispatch: z.boolean(),
  readyToStart: z.boolean(),
  approveSpike: z.boolean().default(false),
});
export type CardControls = z.infer<typeof CardControlsSchema>;

/** What `cardControls` reads of one plan. */
export interface CardControlsReadings {
  /** The plan's state as the file spells it, lowercased. */
  state: string;
  /** The plan's measured status. */
  status: PlanStatus;
  /** Whether the plan records a `Started:` entry. */
  started: boolean;
  /** The plan's slices; absent reads as a plan with no spike. */
  slices?: readonly SpikeSlice[];
  /** The `Spike approved:` record as written, or `''`. Absent reads as `''`. */
  spikeApproved?: string;
}

/**
 * The controls a plan card offers.
 *
 * `approve` and `interrogate` hold on the `draft` and `design` states.
 * `commission` and `roundsBadge` hold on the `draft` state only: the commission
 * command refuses every other state, and the interrogation-rounds badge shows
 * on a Draft card only. `dispatch` holds where `status` is `approved` or `in-progress`. `readyToStart` holds where
 * `dispatch` holds and the plan records no `Started:` entry.
 *
 * A control answers whether the card renders the button. It does not answer
 * whether the command succeeds: each command keeps its own preconditions.
 *
 * `approveSpike` holds on a `design` plan whose one `<!-- spike -->` branch is the
 * only branch of the first slice and which records no `Spike approved:` line.
 *
 * @param readings - the plan's state, status, started record, slices and spike record.
 * @returns the seven control booleans.
 */
export const cardControls = (readings: CardControlsReadings): CardControls => {
  const draft = readings.state === 'draft';
  const underReview = draft || readings.state === 'design';
  const dispatch = readings.status === 'approved' || readings.status === 'in-progress';
  const slices = readings.slices ?? [];
  const spike = spikeOf(slices);
  const approveSpike =
    readings.state === 'design' &&
    (readings.spikeApproved ?? '').trim() === '' &&
    spike !== undefined &&
    spike.slice === 0 &&
    slices[0].branches.length === 1;
  return {
    approve: underReview,
    interrogate: underReview,
    commission: draft,
    roundsBadge: draft,
    dispatch,
    readyToStart: dispatch && !readings.started,
    approveSpike,
  };
};
