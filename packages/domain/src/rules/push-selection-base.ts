/**
 * The commit a `main` push run's selection diffs from: the head of the newest
 * `CI` push run on `main` that concluded `success`, where it lies on the
 * head's first-parent line.
 */

import { ANCESTOR_WALK_DEPTH } from './default-branch.js';

/** What the caller read. */
export interface PushSelectionReadings {
  /**
   * The head SHA of the newest successful `CI` push run on `main`: `null`
   * where the call failed, `''` where no such run exists.
   */
  readonly greenHead: string | null;
  /** `git rev-list --first-parent -n 50 HEAD`, newest first, the head included. */
  readonly firstParent: readonly string[];
}

/** Why a push run selects every job. */
export type PushSelectionEvery = 'api-failed' | 'no-green-run' | 'not-on-line';

/** The answer: the base to diff from, or the reason every job runs. */
export type PushSelectionBase = { readonly base: string } | { readonly every: PushSelectionEvery };

/**
 * Chooses the base of a `main` push run's selection.
 *
 * @param readings - the green head and the head's first-parent line.
 * @returns `{ base }` where the green head equals one of the first
 *   {@link ANCESTOR_WALK_DEPTH} entries of `firstParent`, by string equality.
 *   Otherwise `{ every }`: `api-failed` for a `null` green head,
 *   `no-green-run` for an empty one, and `not-on-line` for a green head that
 *   no entry equals.
 */
export const pushSelectionBase = (readings: PushSelectionReadings): PushSelectionBase => {
  const { greenHead, firstParent } = readings;
  if (greenHead === null) return { every: 'api-failed' };
  const head = greenHead.trim();
  if (head === '') return { every: 'no-green-run' };
  return firstParent.slice(0, ANCESTOR_WALK_DEPTH).includes(head) ? { base: head } : { every: 'not-on-line' };
};
