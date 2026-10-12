import { spikeOf, type SpikeSlice } from './spike.js';

/** Where a Design plan stands against its spike, as its card words it. */
export type SpikeCardState = 'spike-not-approved' | 'spike-approved' | 'spike-merged';

/** What `spikeCardState` reads of one plan. */
export interface SpikeCardReadings {
  /** The plan's state as the file spells it, lowercased. */
  state: string;
  /** The plan's slices; absent reads as a plan with no spike. */
  slices?: readonly SpikeSlice[];
  /** The `Spike approved:` record as written, or `''`. Absent reads as `''`. */
  spikeApproved?: string;
  /** Whether the host reports the spike branch's PR merged. Absent reads as not merged. */
  spikeMerged?: boolean;
}

/**
 * Which of three states a Design plan's card shows for its spike.
 *
 * `spike-not-approved` holds until the `Spike approved:` record exists,
 * `spike-approved` while the approved spike has not merged, and `spike-merged`
 * once it has: the slices are then ready to confirm.
 *
 * @param readings - the plan's state, slices, spike record and spike merge reading.
 * @returns the state, or null for a plan that is not in `design` or names no
 *   single spike.
 */
export const spikeCardState = (readings: SpikeCardReadings): SpikeCardState | null => {
  if (readings.state !== 'design') return null;
  if (spikeOf(readings.slices ?? []) === undefined) return null;
  if ((readings.spikeApproved ?? '').trim() === '') return 'spike-not-approved';
  return readings.spikeMerged === true ? 'spike-merged' : 'spike-approved';
};

/** A fact the approval needs from outside the plan, shaped like a transition's `Precondition`. */
export interface ConfirmReading {
  /** What was read: the spike branch, or the plan file's path. */
  name: string;
  /** Whether the reading permits the approval. */
  met: boolean;
  /** What the source said. */
  detail?: string;
}

/** What `confirmRefusal` reads. */
export interface ConfirmReadings {
  /** The plan's slug. */
  slug: string;
  /** The plan's phase, lowercased. */
  phase: string;
  /** The `Spike approved:` record as written, or `''`. */
  spikeApproved: string;
  /** The host's `mergedAt` reading for the spike branch; absent means it was not read. */
  spikeMerged?: ConfirmReading;
  /** Whether the plan file in the checkout equals the copy on `origin/<main>`; absent means it was not read. */
  slicesPushed?: ConfirmReading;
}

/** The gate a confirmation fired. */
export interface ConfirmRefusal {
  readonly reason: 'spike-unmerged' | 'slices-unpushed';
  readonly detail: string;
}

/**
 * The refusal that stops a Design plan with an approved spike from leaving
 * Design, or nothing.
 *
 * Applies only to a `design` plan that records `Spike approved:`; every other
 * plan answers nothing. A reading that is absent counts as unmet, because the
 * approval it guards cannot be undone. The spike is asked first, since the
 * slices cannot be confirmed before the spike has proved them.
 *
 * @param readings - the plan's phase and spike record, and the two readings.
 * @returns `spike-unmerged` or `slices-unpushed` with the command that repairs
 *   it, or undefined where the approval may go on.
 */
export const confirmRefusal = (readings: ConfirmReadings): ConfirmRefusal | undefined => {
  if (readings.phase !== 'design') return undefined;
  if (readings.spikeApproved.trim() === '') return undefined;
  const { slug, spikeMerged, slicesPushed } = readings;
  if (spikeMerged === undefined || !spikeMerged.met) {
    const branch = spikeMerged?.name ?? 'spike';
    const said = spikeMerged?.detail ? ` (${spikeMerged.detail})` : '';
    return {
      reason: 'spike-unmerged',
      detail: `the spike '${branch}' of '${slug}' has not merged${said}. Wait for its PR to merge, then run /plot-approve ${slug} again — or drop the '<!-- spike -->' annotation from the plan.`,
    };
  }
  if (slicesPushed === undefined || !slicesPushed.met) {
    const file = slicesPushed?.name ?? 'the plan file';
    const said = slicesPushed?.detail ? ` (${slicesPushed.detail})` : '';
    return {
      reason: 'slices-unpushed',
      detail: `${file} in this checkout differs from the copy on the default branch${said}. Commit and push the rewritten slices to the default branch, then run /plot-approve ${slug} again.`,
    };
  }
  return undefined;
};
