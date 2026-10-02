/**
 * Whether the worktree holding a branch may be removed so that the agent
 * handed that branch can take it.
 *
 * An agent the supervisor hands a slice checks the branch out in its own desk.
 * Git refuses while another worktree holds that branch, and the agent stops.
 * Measured 2026-10-01 (#1151): agent `11945014` was handed
 * `bug/the-merge-subject-is-one-rule` while `.worktrees/the-merge-subject-is-one-rule`
 * held it with no change, no commit and no `.plot-worker.*` file; the board row
 * read *held in a local worktree* until a person ran `git worktree remove`.
 *
 * Six conditions keep the checkout, tested in the order they are declared. Each
 * is a measurement the caller takes, never a judgement this makes.
 *
 * An `unknown` reading keeps the checkout. That is the opposite polarity to
 * `desk_reset_refusal`, which treats an unreadable reading as no refusal: a
 * reset rewrites nothing, while a removal deletes the checkout's only copy of
 * whatever the reading missed.
 *
 * Four condition words are `ReapRefusalSchema`'s, so an operator greps one
 * vocabulary; `registered` and `main-checkout` are this rule's own. The enum
 * itself is deliberately not extended — the reaper's condition set stays what
 * it is.
 */

/**
 * A reading the caller may not have been able to take.
 *
 * `unknown` is a failure to observe and never a `false`: the shell that takes
 * these readings reports it where git, a process table or a directory could not
 * be asked.
 */
export type CheckoutReading = boolean | 'unknown';

/**
 * What the shell measured about the worktree that holds the branch.
 *
 * Every field is about THAT worktree and never about the desk asking. The
 * asking agent is itself a live worker, so passing its own path would make
 * `liveWorker` true of every case.
 */
export interface CheckoutReadings {
  /** The checkout's `.plot-worker.pid` names a live process. */
  readonly liveWorker: CheckoutReading;
  /** A `PLOT-BLOCKED*` file sits in the checkout. */
  readonly blockedMarker: CheckoutReading;
  /** The checkout has uncommitted changes, editor leftovers dropped. */
  readonly uncommittedChanges: CheckoutReading;
  /** The checkout's `HEAD` carries commits its upstream does not. */
  readonly unpushedCommits: CheckoutReading;
  /** An agent manifest in the registry directory names the checkout's path. */
  readonly registered: CheckoutReading;
  /** The checkout is the repository's main worktree. */
  readonly mainCheckout: CheckoutReading;
}

/** Why a checkout keeps its branch. */
export type CheckoutYieldCondition =
  | 'live-worker'
  | 'blocked-marker'
  | 'uncommitted-changes'
  | 'unpushed-commits'
  | 'registered'
  | 'main-checkout';

/**
 * Whether the checkout yields.
 *
 * `yields: true` licenses one `git worktree remove` without `--force`. The
 * condition on a refusal is the first that holds, in declaration order, so the
 * marker a caller writes names one word rather than a set.
 */
export type CheckoutYield =
  | { readonly yields: true }
  | { readonly yields: false; readonly condition: CheckoutYieldCondition };

/** The conditions, in the order they are tested. */
const CONDITIONS: readonly (readonly [CheckoutYieldCondition, keyof CheckoutReadings])[] = [
  ['live-worker', 'liveWorker'],
  ['blocked-marker', 'blockedMarker'],
  ['uncommitted-changes', 'uncommittedChanges'],
  ['unpushed-commits', 'unpushedCommits'],
  ['registered', 'registered'],
  ['main-checkout', 'mainCheckout'],
];

/**
 * Answers whether the worktree holding a branch may be removed.
 *
 * @param readings - what the shell measured about that worktree. An `unknown`
 *   field keeps the checkout, because a removal cannot be undone.
 * @returns `{ yields: true }` when every reading is a measured `false`, or the
 *   first condition that holds.
 */
export const checkoutYield = (readings: CheckoutReadings): CheckoutYield => {
  for (const [condition, field] of CONDITIONS) {
    if (readings[field] !== false) return { yields: false, condition };
  }
  return { yields: true };
};
