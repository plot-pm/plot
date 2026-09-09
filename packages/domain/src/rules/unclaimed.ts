/**
 * What one tick measured of one registered worktree.
 *
 * **THE READING IS THE REGISTRATION, NOT THE DIRECTORY.** Every field here
 * comes from `git worktree list --porcelain` or from a record that names the
 * path — never from walking the filesystem for directories that look like
 * desks. Git's list is the one authority on what the estate is carrying,
 * because it is the list every scan walks.
 */
export interface RegisteredTreeReadings {
  /** The absolute path — git's own identity for the entry. */
  path: string;
  /** The branch it holds, or `''` when HEAD is detached. */
  branch: string;
  /** Whether this is the main checkout. */
  isMain: boolean;
  /** Git's own view that the directory is gone. */
  prunable: boolean;
  /**
   * Whether the agent registry names this path.
   *
   * **THIS IS THE CLAIM, AND A DETACHED DESK CAN CARRY ONE.** The plan read
   * *a detached tree can never be claimed, so it is unclaimed by construction*;
   * measured on this estate 2026-09-09, two of six registered agents held a
   * DETACHED desk, because `plot-dispatch.sh --start` cuts a free agent's tree
   * detached at `origin/<main>` on purpose. Deriving the claim from the HEAD
   * shape would have reported both of them as leftovers while their workers
   * ran.
   */
  registered: boolean;
  /**
   * Whether any plan names the branch this tree holds.
   *
   * The second claim, and it survives the registry: a desk cut by hand for a
   * branch a plan slices is work somebody is doing, whether or not a manifest
   * records it. Meaningless where the tree is detached, since there is no
   * branch to look up — a caller reads `false` there and the branch's absence
   * is what the reading already says.
   */
  planNamed: boolean;
  /**
   * How many uncommitted paths it carries.
   *
   * A tree that could not be read reports its dirt as unknown, and the caller
   * passes the count it has; absent is not zero, applied to a filesystem, so a
   * reader that cannot measure hands a positive number and the tree is named as
   * dirty. That direction is the safe one: the dirty finding tells a person to
   * look, and the clean one prints a removal command.
   */
  dirtyCount: number;
}

/**
 * Whether the estate is carrying this tree for nobody.
 *
 * Three refusals, and each is a measurement:
 *
 * - **The main checkout is never a leftover.** It is the repository.
 * - **A registered desk belongs to an agent.** The supervisor already has a
 *   verdict about it, and naming it here would report every live worker twice.
 * - **A tree on a branch some plan slices is somebody's work.** The manifest
 *   may be gone — a `kill -9` between `git worktree add` and the registry write
 *   leaves exactly that — and the plan still names the branch.
 *
 * A prunable entry IS unclaimed, and deliberately so: git lists it, so every
 * scan walks it, and the directory being gone is what makes `git worktree
 * prune` the repair rather than a reason to stay silent.
 *
 * @param tree - what was measured of the tree.
 * @returns true when nothing on the estate claims it.
 */
export const isUnclaimedTree = (tree: RegisteredTreeReadings): boolean =>
  !tree.isMain && !tree.registered && !tree.planNamed;

/**
 * What a person may do about one unclaimed tree.
 *
 * `remove` and `prune` both name a command; `read-it` names none, and that
 * absence is the finding. The split is the reaper's own — it refuses on a dirty
 * tree because the case where the guard is wrong is the case where destruction
 * cannot be undone — and this report is laxer nowhere.
 */
export type UnclaimedDisposition = 'remove' | 'prune' | 'read-it';

/** One unclaimed tree, named with what a person can do about it. */
export interface UnclaimedTree {
  /** The absolute path. */
  path: string;
  /** The branch it holds, or `''` when detached. */
  branch: string;
  /** How many uncommitted paths it carries. */
  dirtyCount: number;
  /** What a person may do about it. */
  disposition: UnclaimedDisposition;
  /**
   * The command that resolves it, or `''` where a person must read it first.
   *
   * **PRINTED, NEVER RUN.** The supervisor cannot know why a directory exists,
   * so the whole of this finding is a sentence and a command somebody else
   * types. A `remove` that this daemon performed would be the reaper's licence
   * extended to a population the reaper deliberately does not touch.
   */
  command: string;
}

/**
 * What to do about one unclaimed tree, and the command that does it.
 *
 * The order is the confidence order. A vanished directory is git's own answer
 * and no reading inside the tree can overturn it — there is nothing in there to
 * read. Dirt is next, because it is the one condition that stops a removal.
 * What is left is a clean tree nobody claims, which is the population the plan
 * measured twelve of.
 *
 * @param tree - what was measured of the tree.
 * @returns the disposition and its command.
 */
export const dispositionOf = (
  tree: RegisteredTreeReadings,
): Pick<UnclaimedTree, 'disposition' | 'command'> => {
  if (tree.prunable) return { disposition: 'prune', command: 'git worktree prune' };
  if (tree.dirtyCount > 0) return { disposition: 'read-it', command: '' };
  return { disposition: 'remove', command: `git worktree remove ${tree.path}` };
};

/**
 * The registered trees nobody claims, as findings a report can render.
 *
 * @param trees - what was measured of every registered tree.
 * @returns one finding per unclaimed tree, in the order git listed them.
 */
export const unclaimedTrees = (
  trees: readonly RegisteredTreeReadings[],
): UnclaimedTree[] =>
  trees.filter(isUnclaimedTree).map((tree) => ({
    path: tree.path,
    branch: tree.branch,
    dirtyCount: tree.dirtyCount,
    ...dispositionOf(tree),
  }));

/**
 * What one scan pays to walk a worktree, in milliseconds.
 *
 * **MEASURED, NOT ESTIMATED.** `plot-fleet-scan.sh` runs one `git status` per
 * worktree it walks, and the file's own comment records the figure it accepts:
 * 6.6 ms per worktree for the local signals. The number is here rather than in
 * the report so a caller cannot invent a different one, and it is what turns
 * *"12 unclaimed worktrees"* into the sentence a person can act on.
 */
export const SCAN_COST_MS_PER_TREE = 6.6;

/**
 * What the unclaimed trees cost the estate, on every scan, forever.
 *
 * **THE CLEAN ONES AND THE DIRTY ONES BOTH COUNT.** The cost is the walk, and
 * the walk does not care whether a person may remove the tree — a dirty
 * leftover is exactly as expensive as a clean one and is the harder to be rid
 * of. Splitting the number by disposition would report the cheaper half as the
 * whole.
 *
 * @param findings - the unclaimed trees.
 * @returns what one scan spends on them, in milliseconds.
 */
export const scanCostOf = (findings: readonly UnclaimedTree[]): number =>
  Math.round(findings.length * SCAN_COST_MS_PER_TREE);

/**
 * The finding, in the sentence a person reads.
 *
 * **IT SAYS WHAT THEY COST.** *"12 worktrees nobody dispatched — the scan walks
 * all of them"* is actionable where *"12 unclaimed worktrees"* is trivia: the
 * reader arrived from a board that said `timed out after 90000ms — 34
 * worktrees`, and the number that connects the finding to that timeout is the
 * one they need.
 *
 * **AN ESTATE WHERE EVERY WORKTREE IS DISPATCHED REPORTS NOTHING**, not a line
 * of zeros. A supervisor that says *0 unclaimed worktrees* every minute is a
 * line a person learns to skip, and the finding exists to be noticed.
 *
 * @param findings - the unclaimed trees.
 * @returns the sentence, or `''` when there is nothing to report.
 */
export const unclaimedNotice = (findings: readonly UnclaimedTree[]): string => {
  if (findings.length === 0) return '';
  const dirty = findings.filter((f) => f.disposition === 'read-it').length;
  const trees = findings.length === 1 ? 'worktree' : 'worktrees';
  const head = `${findings.length} ${trees} nobody dispatched — the scan walks all of them, ${scanCostOf(findings)}ms every pulse`;
  return dirty === 0 ? head : `${head}; ${dirty} hold uncommitted work and are for a person to read`;
};
