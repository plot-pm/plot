import { z } from 'zod';

/** Where a sprint sits in its life. No gate stands on any of these. */
// plot-state: lifecycle sprint — a timebox is opened, committed to, run and
//                                closed, in that order and once each. NO RULE
//                                YET: it is counted as debt by
//                                scripts/check-state-declarations.sh, which is
//                                what keeps the number from growing.
export const SprintStateSchema = z.enum(['Planning', 'Committed', 'Active', 'Closed']);
export type SprintState = z.infer<typeof SprintStateSchema>;

/**
 * The commitment's shape.
 *
 * Only `must` is a promise: the release gate refuses on an open Must, prompts
 * on an open Should, and reports a Could without blocking. A timebox with one
 * priority level is a queue with a date on it.
 */
// plot-state: classification — a priority. A Could becoming a Must is a
//                              re-prioritisation a person makes, not a
//                              transition, and every tier is reachable from
//                              every other at any moment.
export const MoscowTierSchema = z.enum(['must', 'should', 'could', 'deferred']);
export type MoscowTier = z.infer<typeof MoscowTierSchema>;

/**
 * How an item's checkbox and its plan compare.
 *
 * `done`       the work landed.
 * `open`       it has not.
 * `disputed`   the checkbox says it did and the plan estate says it did not.
 * `withdrawn`  somebody decided the plan will not deliver.
 *
 * `withdrawn` is not a fourth degree of unfinished. The other three compare
 * two records; this one reports a decision the plan itself carries, which is
 * why the checkbox cannot change it.
 */
// plot-state: classification — how a checkbox and a plan COMPARE, recomputed
//                              on every read. 'disputed' is a disagreement
//                              between two sources rather than a stage the item
//                              reached, and 'withdrawn' is a decision one of
//                              them records.
export const ItemStatusSchema = z.enum(['done', 'open', 'disputed', 'withdrawn']);
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
 * What the plan estate says about the plan an item names.
 *
 * `true`            the plan it names has been delivered.
 * `false`           it has not.
 * `'no-plan-named'` the line names no plan, so nothing was looked up.
 * `'withdrawn'`     the plan is `Rejected` or `Superseded`.
 *
 * The third value is not "unknown". An item naming no plan is a lightweight
 * task with one source of truth, and that is a stated limit rather than a
 * failed lookup — a plan that could not be read would be a different reading
 * with a different answer.
 *
 * `Rejected` and `Superseded` arrive as ONE reading. They differ in why, which
 * the plan's own `Rejected:` or `Superseded:` record states; the sprint's
 * question is only whether the item is still owed, and neither is.
 */
export type PlanDelivery = boolean | 'no-plan-named' | 'withdrawn';

/**
 * Scores one item against what the plan estate says actually happened.
 *
 * The estate outranks the checkbox in ONE direction only: a checked box over an
 * undelivered plan is `disputed`, while an unchecked box over a delivered one
 * is `done`, because delivering a plan moves it and nobody re-ticks the box.
 *
 * A WITHDRAWN plan outranks the checkbox in BOTH directions, and that is the
 * same rule rather than a second one: the estate is the stronger record, and
 * here it carries a decision no box can contradict. Ticked or unticked, the
 * work is not going to happen. It is not `done` — nothing shipped — and it is
 * not `disputed`, because the box and the plan do not disagree about anything.
 *
 * An item naming NO plan has only its checkbox, so it is taken at face value
 * and can never be `disputed`: a dispute is a disagreement between two sources
 * and such an item has one.
 *
 * @param item - the sprint item to score.
 * @param delivered - what the estate says about the plan it names.
 * @returns the item's status.
 */
export const scoreItem = (item: SprintItem, delivered: PlanDelivery): ItemStatus => {
  if (delivered === 'withdrawn') return 'withdrawn';
  if (delivered === 'no-plan-named') return item.checked ? 'done' : 'open';
  if (delivered) return 'done';
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
