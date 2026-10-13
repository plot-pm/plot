import { spikeOf, type SpikeSlice } from './spike.js';

/** Where a Design plan stands against its spike, as its card words it. */
export type SpikeCardState = 'spike-not-approved' | 'spike-approved' | 'spike-merged';

/** The line a card shows for each {@link SpikeCardState}. */
export const SPIKE_CARD_TEXT: Readonly<Record<SpikeCardState, string>> = {
  'spike-not-approved': 'spike not approved yet',
  'spike-approved': 'spike approved — waiting for its PR to merge',
  'spike-merged': 'spike merged — confirm the slices to approve',
};

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

/**
 * Whether a plan waits on its spike before it may leave Design.
 *
 * Holds for a `design` plan that names one spike branch (see {@link spikeOf})
 * while that branch has not merged. The `Spike approved:` record is not read: a
 * plan whose spike was never approved waits too, and a plan with no annotation,
 * or with more than one, does not wait. The card's Approve control and
 * {@link confirmRefusal} both ask this.
 *
 * @param phase - the plan's phase, lowercased.
 * @param slices - the plan's slices in document order.
 * @param merged - whether the host reports the spike branch's PR merged.
 * @returns true while the spike holds the approval.
 */
export const awaitsSpike = (phase: string, slices: readonly SpikeSlice[], merged: boolean): boolean =>
  phase === 'design' && spikeOf(slices) !== undefined && !merged;

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
  /** The plan's slices in document order; the spike is the branch {@link spikeOf} names. */
  slices: readonly SpikeSlice[];
  /** The host's `mergedAt` reading for the spike branch; absent means it was not read. */
  spikeMerged?: ConfirmReading;
  /**
   * Whether the plan file in the checkout matches the copy on `origin/<main>`;
   * absent means it was not read. The `detail` says why it does not, and the
   * refusal quotes it.
   */
  slicesPushed?: ConfirmReading;
}

/** The gate a confirmation fired. */
export interface ConfirmRefusal {
  readonly reason: 'spike-unmerged' | 'slices-unpushed';
  readonly detail: string;
}

/**
 * The refusal that stops a Design plan with a spike from leaving Design, or
 * nothing.
 *
 * Applies only to a `design` plan that names one spike branch; every other plan
 * answers nothing, so removing the `<!-- spike -->` annotation lifts both
 * refusals. A reading that is absent counts as unmet, because the approval it
 * guards cannot be undone. The spike is asked first, since the slices cannot be
 * confirmed before the spike has proved them.
 *
 * @param readings - the plan's phase and slices, and the two readings.
 * @returns `spike-unmerged` or `slices-unpushed` with the step that repairs it,
 *   or undefined where the approval may go on.
 */
export const confirmRefusal = (readings: ConfirmReadings): ConfirmRefusal | undefined => {
  const { slug, slices, spikeMerged, slicesPushed } = readings;
  const spike = spikeOf(slices);
  if (readings.phase !== 'design' || spike === undefined) return undefined;
  if (awaitsSpike(readings.phase, slices, spikeMerged?.met === true)) {
    const said = spikeMerged === undefined
      ? ' (its merge was not read)'
      : spikeMerged.detail ? ` (${spikeMerged.detail})` : '';
    return {
      reason: 'spike-unmerged',
      detail: `the spike '${spike.branch}' of '${slug}' has not merged${said}. Wait for its PR to merge, then run /plot-approve ${slug} again — or remove the '<!-- spike -->' annotation from the plan.`,
    };
  }
  if (slicesPushed === undefined || !slicesPushed.met) {
    const file = slicesPushed?.name ?? 'the plan file';
    const said = slicesPushed?.detail ? ` ${slicesPushed.detail}` : ' was not compared with the default branch. Commit and push the rewritten slices to the default branch';
    return {
      reason: 'slices-unpushed',
      detail: `${file}${said}, then run /plot-approve ${slug} again.`,
    };
  }
  return undefined;
};

/** The copies of one plan file that {@link slicesPushedOf} compares. Absent means that copy does not exist or was not read. */
export interface PlanCopies {
  /** The plan file's path, relative to the repository root. */
  file: string;
  /** The default branch's name. */
  main: string;
  /** The working tree's copy. */
  working?: string;
  /** The copy at the checkout's `HEAD`. */
  head?: string;
  /** The copy at the merge base of `HEAD` and `origin/<main>`. */
  base?: string;
  /** The copy on `origin/<main>`. */
  remote?: string;
}

/**
 * Whether the plan in the checkout matches the copy the approval books, and
 * what to do where it does not.
 *
 * Met when the working tree's copy equals the copy on `origin/<main>`.
 * Otherwise the detail names one of five cases: the default branch holds no
 * copy; the checkout's copy could not be read; the working tree has
 * uncommitted edits; the checkout is only behind, which a pull repairs; or the
 * checkout has commits the default branch does not hold, which a push repairs.
 *
 * @param copies - the plan file's copies in the working tree, at `HEAD`, at the
 *   merge base and on `origin/<main>`.
 * @returns the reading, named by the plan file, with a detail that ends in the
 *   step that repairs it.
 */
export const slicesPushedOf = (copies: PlanCopies): ConfirmReading => {
  const { file: name, working, head, base, remote } = copies;
  const origin = `origin/${copies.main}`;
  if (remote === undefined) {
    return { name, met: false, detail: `is not on ${origin}. Commit it and push it to the default branch` };
  }
  if (working === undefined) {
    return { name, met: false, detail: `could not be read in this checkout. Approve from a checkout that holds it` };
  }
  if (working === remote) return { name, met: true };
  if (working !== head) {
    return { name, met: false, detail: `has edits in this checkout that are not committed. Commit them and push them to the default branch` };
  }
  if (head === base) {
    return { name, met: false, detail: `in this checkout is behind ${origin}. Pull the default branch and read the slices again` };
  }
  if (remote === base) {
    return { name, met: false, detail: `has commits in this checkout that ${origin} does not hold. Push them to the default branch` };
  }
  return { name, met: false, detail: `has commits in this checkout that ${origin} does not hold, and ${origin} changed it too. Pull the default branch, then push` };
};
