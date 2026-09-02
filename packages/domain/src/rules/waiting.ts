import type { BranchState, SliceVerdict } from '../entities/fleet.js';

/**
 * One slice, as the outlook reads it: what it was decided to be, and what its
 * branches are.
 *
 * The verdict comes from {@link sliceVerdicts} and is not re-derived here. The
 * states are in the plan's own order, one per branch of the slice.
 */
export interface SliceOutlookReading {
  /** The slice's verdict, as `sliceVerdicts` decided it. */
  verdict: SliceVerdict;
  /** The slice's branches and their measured states, in the plan's order. */
  branches: readonly { name: string; state: BranchState }[];
}

/**
 * Why a worker was offered nothing — and therefore whether it should wait.
 *
 * `available` a branch is claimable now; the caller should have taken it
 * `not-yet`   nothing is claimable, but a blocked slice holds unstarted work
 * `none`      nothing is claimable and nothing ever will be for this plan
 *
 * THE TWO NOTHINGS ARE THE POINT. `--next` exits 1 for both, and a worker that
 * ends on `not-yet` pays a full dispatch — worktree, claim, warm-up — to reach
 * a slice it was already standing next to. A worker that WAITS on `none` never
 * exits at all, which is worse than ending: today it ends honestly.
 */
export type NextWorkOutlook = 'available' | 'not-yet' | 'none';

/**
 * What a worker is still standing in front of, and what would clear it.
 *
 * `blockers` is empty for every outlook but `not-yet`, and never empty for
 * `not-yet`: a wait with nothing to wait on is a wait that cannot end, so the
 * absence of a nameable blocker is what makes the answer `none` instead.
 */
export interface NextWork {
  outlook: NextWorkOutlook;
  /**
   * The branches whose landing would open the blocked slice — the outstanding
   * branches of every slice ahead of it.
   *
   * NAMES, not a count. The waiting caller watches these refs, so a number
   * would tell it to wait without telling it what to watch.
   */
  blockers: readonly string[];
}

/** A branch in one of these states is finished with, whatever its slice says. */
const SETTLED: readonly BranchState[] = ['merged', 'deferred'];

/** A branch in one of these states is somebody's already. */
const TAKEN: readonly BranchState[] = ['claimed', 'wip'];

/**
 * Is there work for this worker, is there work it cannot have yet, or is there
 * none — from the plan's slices and no I/O.
 *
 * The three answers are decided in order, and the order is the rule:
 *
 * 1. **`available` outranks everything.** A claimable branch means the caller's
 *    `--next` and this disagree, and the caller should act on the branch rather
 *    than on this. It is reported rather than hidden so a caller can say so.
 * 2. **`not-yet` needs BOTH halves.** A `blocked` slice holding an unstarted
 *    branch is work this worker could take once the slices ahead of it land.
 *    A `blocked` slice whose every branch is already claimed is not: waiting on
 *    it would be waiting for a desk somebody else is sitting at.
 * 3. **Everything else is `none`.** A complete plan, a plan whose remaining
 *    branches are all taken, and an unapproved plan all answer the same way:
 *    end honestly.
 *
 * `unapproved` IS `none`, deliberately. That verdict resolves by a person
 * approving the plan, not by work landing, so nothing a worker can wait for
 * would clear it — and a worker holding a desk while it waits for a human is
 * the shape this slice exists to avoid rather than to create.
 *
 * @param slices The plan's slices in the plan's own order, with verdicts.
 * @returns The outlook, and the branches a `not-yet` is waiting on.
 */
export const nextWork = (slices: readonly SliceOutlookReading[]): NextWork => {
  const claimableExists = slices.some(
    (slice) => slice.verdict === 'eligible'
      && slice.branches.some((branch) => branch.state === 'open'),
  );
  if (claimableExists) return { outlook: 'available', blockers: [] };

  // What stands in front of a blocked slice is every unsettled branch of the
  // slices BEFORE it — that is what `sliceVerdicts` folded over to decide
  // `blocked` in the first place, so the same walk recovers the names.
  const blockers: string[] = [];
  const ahead: string[] = [];
  for (const slice of slices) {
    const startable = slice.branches.filter(
      (branch) => !SETTLED.includes(branch.state) && !TAKEN.includes(branch.state),
    );
    if (slice.verdict === 'blocked' && startable.length > 0 && ahead.length > 0) {
      // The first blocked slice with work to take decides it. Later ones are
      // behind this one, so their blockers include these.
      blockers.push(...ahead);
      break;
    }
    ahead.push(
      ...slice.branches
        .filter((branch) => !SETTLED.includes(branch.state))
        .map((branch) => branch.name),
    );
  }

  return blockers.length > 0
    ? { outlook: 'not-yet', blockers }
    : { outlook: 'none', blockers: [] };
};
