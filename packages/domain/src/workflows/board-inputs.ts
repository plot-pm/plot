import type { DeliveredInput, SprintsValue, StoriesValue } from '../entities/board-readings.js';
import type { BranchPlansValue, PlanEntry, ReadingKey, RefEntry, RepoSnapshot } from '../entities/snapshot.js';
import { parsedPlans } from '../rules/parsed-plans.js';

/** The remote prefix of the ref the `plans` reading names, such as `origin/main`. */
const REMOTE_PREFIX = 'origin/';

/**
 * What the board's plan cards read from the default branch, as one snapshot
 * holds it. The board reads the checkout's own files beside these.
 */
export interface BoardInputs {
  /** The default branch's short name, such as `main`. */
  readonly defaultBranch: string;
  /** The ref the plan files were read at, such as `origin/main`. */
  readonly planRef: string;
  /** The commit {@link BoardInputs.planRef} resolved to. */
  readonly resolved: string;
  /**
   * The plan files the default branch holds, in reading order: the `plans`
   * records without the ones `branchPlans` names. A file the parser could not
   * read is absent.
   */
  readonly plans: readonly PlanEntry[];
  /** Plan path → the git author of the commit that first added it. */
  readonly authors: Readonly<Record<string, string>>;
  /** Plan path → the verification inputs of each plan in phase `delivered`. */
  readonly delivered: Readonly<Record<string, DeliveredInput>>;
  /** The plans on prefixed branches that the default branch does not hold. */
  readonly branchPlans: BranchPlansValue;
  /** The sprint files under `<Sprint directory>/active/`. */
  readonly sprints: SprintsValue;
  /** The live and the archived story files. */
  readonly stories: StoriesValue;
  /** Every ref and its object, as fleetd listed them. */
  readonly refs: readonly RefEntry[];
}

/** A value {@link boardInputsFrom} cannot answer from: a reading key, or one answer inside the `plans` reading. */
export type BoardInputGap = ReadingKey | 'plans.ref' | 'plans.authors' | 'plans.delivered';

/**
 * The board's plan-card inputs from one snapshot.
 *
 * @param snapshot - the snapshot fleetd sent.
 * @returns `{ inputs }`, or `{ unknown }` naming the first value that is not
 *   read: a reading among `refs`, `plans`, `branchPlans`, `sprints` and
 *   `stories` that is `unread` or `failed`; `plans.ref` where the plans were
 *   read from the checkout or from a ref outside `origin/`; `plans.authors` or
 *   `plans.delivered` where that answer failed.
 */
export const boardInputsFrom = (snapshot: RepoSnapshot): { inputs: BoardInputs } | { unknown: BoardInputGap } => {
  const { refs, plans, branchPlans, sprints, stories } = snapshot.readings;
  if (refs.state !== 'read') return { unknown: 'refs' };
  if (plans.state !== 'read') return { unknown: 'plans' };
  if (!plans.value.ref.startsWith(REMOTE_PREFIX) || plans.value.resolved === '') return { unknown: 'plans.ref' };
  if (plans.value.authors.state !== 'read') return { unknown: 'plans.authors' };
  if (plans.value.delivered.state !== 'read') return { unknown: 'plans.delivered' };
  if (branchPlans.state !== 'read') return { unknown: 'branchPlans' };
  if (sprints.state !== 'read') return { unknown: 'sprints' };
  if (stories.state !== 'read') return { unknown: 'stories' };
  const onBranches = new Set(branchPlans.value.map(({ path }) => path));
  return {
    inputs: {
      defaultBranch: plans.value.ref.slice(REMOTE_PREFIX.length),
      planRef: plans.value.ref,
      resolved: plans.value.resolved,
      plans: parsedPlans(plans.value.records).filter((record) => !onBranches.has(record.file)),
      authors: plans.value.authors.value,
      delivered: plans.value.delivered.value,
      branchPlans: branchPlans.value.filter(({ record }) => record.error === undefined),
      sprints: sprints.value,
      stories: stories.value,
      refs: refs.value.entries,
    },
  };
};
