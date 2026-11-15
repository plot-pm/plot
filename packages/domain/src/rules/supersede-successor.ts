/**
 * The readings a supersession needs about its successor, as preconditions for
 * `supersede` (`transitions/plan.ts`).
 *
 * @concept supersede-successor
 */
import type { Precondition } from '../transitions/plan.js';

/** What the caller measured about the plan and the successor it names. */
export interface SuccessorReading {
  /** The slug of the plan to supersede. */
  readonly slug: string;
  /** The slug `--by` names. */
  readonly by: string;
  /** The successor's plan file, repository-relative, or `''` where no plan file carries the slug. */
  readonly successorFile: string;
}

/**
 * The preconditions a supersession's successor must meet.
 *
 * `same-plan` is unmet where the successor is the plan itself.
 * `successor-not-found` is unmet where the successor names no plan file. An
 * empty `by` produces no reading: `supersede` refuses it as `successor-missing`.
 *
 * @param reading - the plan's slug, the successor's slug, and the successor's file.
 * @returns the two readings, `same-plan` first.
 */
export const successorPreconditions = (reading: SuccessorReading): readonly Precondition[] => {
  const by = reading.by.trim();
  if (by === '') return [];
  return [
    {
      name: 'same-plan',
      met: by !== reading.slug,
      detail: `plan '${reading.slug}' cannot supersede itself. Name the plan that replaces it.`,
    },
    {
      name: 'successor-not-found',
      met: reading.successorFile !== '',
      detail: `no plan file carries the slug '${by}'. A supersession that points nowhere loses the work. Create the successor plan first, or check the slug.`,
    },
  ];
};
