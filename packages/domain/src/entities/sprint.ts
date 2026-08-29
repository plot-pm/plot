import { z } from 'zod';

/** Where a sprint sits in its life. No gate stands on any of these. */
export const SprintStateSchema = z.enum(['Planning', 'Committed', 'Active', 'Closed']);
export type SprintState = z.infer<typeof SprintStateSchema>;

/**
 * The commitment's shape.
 *
 * Only `must` is a promise: the release gate refuses on an open Must, prompts
 * on an open Should, and reports a Could without blocking. A timebox with one
 * priority level is a queue with a date on it.
 */
export const MoscowTierSchema = z.enum(['must', 'should', 'could', 'deferred']);
export type MoscowTier = z.infer<typeof MoscowTierSchema>;

/**
 * How an item's checkbox and its plan compare.
 *
 * `done`      the work landed.
 * `open`      it has not.
 * `disputed`  the checkbox says it did and the plan estate says it did not.
 */
export const ItemStatusSchema = z.enum(['done', 'open', 'disputed']);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** One MoSCoW item: a commitment naming a plan. */
export interface SprintItem {
  /** Which commitment tier it sits in. */
  tier: MoscowTier;
  /** Whether the sprint file's checkbox is ticked. */
  checked: boolean;
  /** The slug of the plan it names; `''` when the line names no plan. */
  plan: string;
  /** The sprint's own wording of the item. */
  text: string;
  /** Any status annotation the line carries. */
  annotation: string;
}

/**
 * A timebox committing to a set of plans against a release.
 *
 * Identity: a slug — the filename without extension, which carries its own
 * week and fails by collision. State: stated in the file, so it can be wrong.
 */
export interface Sprint {
  /** The filename without extension — the identity; carries its own week. */
  slug: string;
  /** The `# Sprint: …` heading. */
  title: string;
  /** Where the sprint sits in its life. */
  state: SprintState;
  /** When it starts, ISO-8601. */
  start: string;
  /** When it was planned to end, ISO-8601. */
  plannedEnd: string;
  /** When it actually ended, ISO-8601; null while it has not. */
  actualEnd: string | null;
  /** The release this sprint targets — the gate's key. */
  release: string;
  /** The `## Sprint Goal` prose. */
  goal: string;
  /** The MoSCoW items. */
  items: readonly SprintItem[];
}

/**
 * Scores one item against what the plan estate says actually happened.
 *
 * The estate outranks the checkbox in ONE direction only: a checked box over an
 * undelivered plan is `disputed`, while an unchecked box over a delivered one
 * is `done`, because delivering a plan moves it and nobody re-ticks the box.
 *
 * @param item - the sprint item to score.
 * @param planIsDelivered - whether the plan it names has been delivered.
 * @returns the item's status.
 */
export const scoreItem = (item: SprintItem, planIsDelivered: boolean): ItemStatus => {
  if (planIsDelivered) return 'done';
  return item.checked ? 'disputed' : 'open';
};

/**
 * Whether an item is a promise the release gate refuses on.
 *
 * @param item - the item to test.
 * @returns true when the item is a Must.
 */
export const isPromised = (item: SprintItem): boolean => item.tier === 'must';

/**
 * The distinct plans a sprint commits to.
 *
 * Deduplicated by slug: a plan cut into several slices is listed once per
 * slice, so counting lines overstates the membership. Items naming no plan are
 * excluded.
 *
 * @param sprint - the sprint to read.
 * @returns each plan slug once, in the order first named.
 */
export const sprintMembers = (sprint: Sprint): string[] => [
  ...new Set(sprint.items.map((item) => item.plan).filter((slug) => slug !== '')),
];
