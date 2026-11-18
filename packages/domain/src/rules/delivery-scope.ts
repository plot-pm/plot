import type { Reader } from './ownership.js';
import { sprintIsMine } from './sprint-ownership.js';

/** The tooltip of the disabled `My sprint` toggle. */
export const MY_SPRINT_DISABLED = 'You own no active sprint';

/** `release`: every Active sprint together. `my-sprint`: the Active sprints the reader owns. */
export type DeliveryScopeKind = 'release' | 'my-sprint';

/** The sprint fields the scope reads. */
export interface ScopeSprint {
  readonly slug: string;
  /** The sprint's `Owner:` handle as written, `''` where absent. */
  readonly ownerHandle: string;
}

/** The Delivery tab's scope: which sprints the status card, You and Work items read. */
export interface DeliveryScope<S extends ScopeSprint> {
  readonly kind: DeliveryScopeKind;
  /** The sprints in scope: every Active sprint for `release`, the owned and selected ones for `my-sprint`. */
  readonly sprints: readonly S[];
  /** The Active sprints the reader owns, in Active order. The toggle's click selects these. */
  readonly owned: readonly S[];
  /**
   * The sprint slugs that narrow the rows of You and Work items: the slugs of `sprints` for
   * `my-sprint`, `[]` for `release`, where the rows are not narrowed.
   */
  readonly selection: readonly string[];
  /** The status card the scope shows: the release cards for `release`, the sprint card for `my-sprint`. */
  readonly statusCard: 'release' | 'sprint';
  /** `MY_SPRINT_DISABLED` where the reader owns no Active sprint, `null` otherwise. */
  readonly disabledReason: string | null;
}

/**
 * The Delivery tab's scope, from the `My sprint` toggle, the reader and the Active sprints.
 *
 * The toggle's state is the reader's sprint selection: it is on while the selection names at least
 * one Active sprint the reader owns, and the scope is then those owned sprints the selection names.
 * A selected slug the reader does not own narrows nothing. Ownership is `sprintIsMine` alone, so a
 * sprint with no Owner, or with an Owner `People` does not declare, is in no reader's `my-sprint`
 * scope and is always in the `release` scope. A reader who owns no Active sprint, which includes
 * no sprint being Active and an unread directory, gets the `release` scope and the disabled reason.
 *
 * @param selected - the reader's sprint selection, the toggle's state; empty means off.
 * @param reader - who is reading.
 * @param sprints - the Active sprints.
 * @returns the scope.
 */
export const deliveryScope = <S extends ScopeSprint>(
  selected: readonly string[],
  reader: Reader,
  sprints: readonly S[],
): DeliveryScope<S> => {
  const owned = sprints.filter((s) => sprintIsMine(s.ownerHandle, reader));
  const disabledReason = owned.length === 0 ? MY_SPRINT_DISABLED : null;
  const mine = owned.filter((s) => selected.includes(s.slug));
  if (mine.length === 0) {
    return { kind: 'release', sprints, owned, selection: [], statusCard: 'release', disabledReason };
  }
  return { kind: 'my-sprint', sprints: mine, owned, selection: mine.map((s) => s.slug), statusCard: 'sprint', disabledReason };
};
