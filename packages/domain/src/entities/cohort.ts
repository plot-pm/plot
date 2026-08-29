import { z } from 'zod';

/**
 * A slice's place in a plan: one branch's worth of a plan's work.
 *
 * Referenced by identity rather than held, so this module stays independent of
 * the entity graph that names slices.
 */
export interface SliceRef {
  /** The slug of the plan this slice belongs to. */
  plan: string;
  /** The name of the slice within that plan. */
  name: string;
  /** The one branch it holds. */
  branch: string;
}

/**
 * What the fleet lands together — slices from several plans, assembled at
 * dispatch.
 *
 * THIS IS THE FLEET'S CROSS-PLAN COHORT, the entity `DESIGN-slice.md` renamed
 * to distinguish it from a Slice. A Slice holds exactly one branch, belongs to
 * exactly one plan, and is authored by a person in a plan file. This belongs to
 * no plan, is assembled by the fleet, and is written nowhere.
 *
 * It has NO CONSTRUCTOR, deliberately. Nothing forms one today: the dispatcher
 * requires a plan slug and computes ordering within one plan, so no component
 * sees eligible slices across plans. The two halves exist and have never been
 * joined — the fleet scan computes which slices are eligible across all plans,
 * and the merge queue computes which finished branches can land together. This
 * type is the shape they would meet in, bounded by the agent count.
 *
 * A type with no way to build one is the honest form for an entity with no
 * source of truth. It becomes constructible when something forms one.
 */
export interface Cohort {
  /** The slices assembled to land together. */
  slices: readonly SliceRef[];
  /** The concurrency ceiling this cohort was bounded by. */
  parallelAgents: number;
}

/**
 * How a cohort's size may be bounded.
 *
 * `agents` is the ceiling on how many can run at once; `landable` is how many
 * can merge together without colliding. Which bound wins is an open question:
 * starting five agents whose work cannot land together is precisely the burst
 * the merge queue was written to predict.
 */
export const CohortBoundSchema = z.enum(['agents', 'landable']);
export type CohortBound = z.infer<typeof CohortBoundSchema>;

/**
 * Whether a slice reference names a branch at all.
 *
 * A plan section naming no branch is a plan nobody has sliced rather than a
 * slice holding none — 9 of 11 such sections measured here are prose headings a
 * parser read as slices.
 *
 * @param slice - the slice reference to test.
 * @returns true when it names a plan, a slice and a branch.
 */
export const isSliced = (slice: SliceRef): boolean =>
  slice.plan !== '' && slice.name !== '' && slice.branch !== '';

/**
 * The plans a set of slices spans.
 *
 * What distinguishes a fleet cohort from a plan's own slices: more than one
 * plan means the cohort is doing the thing no component does today.
 *
 * @param slices - the slices to read.
 * @returns each plan slug once, in the order first named.
 */
export const plansSpanned = (slices: readonly SliceRef[]): string[] => [
  ...new Set(slices.map((slice) => slice.plan).filter((plan) => plan !== '')),
];
