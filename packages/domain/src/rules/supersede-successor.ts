/**
 * The readings a supersession needs about its successor, as preconditions for
 * `supersede` (`transitions/plan.ts`).
 *
 * @concept supersede-successor
 */
import type { Precondition, Refusal, RefusalReason } from '../transitions/plan.js';

/** The two successor readings, named as their refusals are. */
export type SuccessorRefusal = 'same-plan' | 'successor-not-found';

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

/**
 * The reason a supersession refusal names: the unmet successor reading where
 * `supersede` refused `precondition-unmet` on one, else the refusal's own reason.
 *
 * @param refusal - the refusal `supersede` returned.
 * @param preconditions - the readings it was given.
 * @returns `same-plan`, `successor-not-found`, or the domain's refusal reason.
 */
export const supersessionRefusalReason = (
  refusal: Refusal,
  preconditions: readonly Precondition[],
): SuccessorRefusal | RefusalReason => {
  if (refusal.reason !== 'precondition-unmet') return refusal.reason;
  const failing = preconditions.find((p) => !p.met)?.name;
  return failing === 'same-plan' || failing === 'successor-not-found' ? failing : refusal.reason;
};

/**
 * The plans a person can name as a plan's successor: every other slug the
 * board holds, sorted, without repeats.
 *
 * @param slug - the plan to supersede.
 * @param slugs - the plan slugs the board holds.
 * @returns the candidate successor slugs.
 */
export const successorCandidates = (slug: string, slugs: readonly string[]): readonly string[] =>
  [...new Set(slugs)].filter((s) => s !== slug).sort();

/** Whether a typed successor can be submitted, and why not. */
export interface SuccessorEntry {
  /** The slug to submit, trimmed. */
  readonly by: string;
  /** Whether the entry can be submitted. */
  readonly ready: boolean;
  /** Why it cannot, or `null` where it can. */
  readonly reason: string | null;
}

/**
 * Reads what a person typed as a plan's successor.
 *
 * An empty entry is not ready, and neither is the plan's own slug. Whether
 * the successor has a plan file is the controller's reading, not this one.
 *
 * @param slug - the plan to supersede.
 * @param typed - the text the person entered.
 * @returns the trimmed slug, and whether and why not it can be submitted.
 */
export const successorEntry = (slug: string, typed: string): SuccessorEntry => {
  const by = typed.trim();
  if (by === '') return { by, ready: false, reason: 'name the successor plan first' };
  if (by === slug) return { by, ready: false, reason: 'a plan cannot supersede itself' };
  return { by, ready: true, reason: null };
};
