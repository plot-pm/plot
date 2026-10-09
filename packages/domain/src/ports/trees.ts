import type { PortResult } from '../port-result.js';
import type { Worktree } from '../entities/worktree.js';
import type { TreePresence } from '../rules/reapable.js';
import type { CommitReading } from '../rules/sample.js';

/**
 * Reads the worktrees on this machine — the DERIVED source of truth about desks.
 *
 * A worktree is found by asking git which one holds a branch, never by
 * rebuilding a path from the branch's name: hand-made worktrees are the
 * population with no claim, and they rarely follow any naming convention.
 */
export interface Trees {
  /**
   * Lists every worktree git knows about on this machine.
   *
   * @returns the worktrees, the main checkout among them.
   */
  list(): Promise<PortResult<readonly Worktree[]>>;

  /**
   * Finds the worktree holding a branch.
   *
   * @param branch - the branch to look for.
   * @returns the worktree, or null when no worktree on this machine holds it.
   */
  forBranch(branch: string): Promise<PortResult<Worktree | null>>;

  /**
   * Whether git can still take a reading from a worktree, and in what state.
   *
   * THE PRIOR QUESTION. Every other reading here measures something *inside* a
   * directory — cleanliness, markers, dirty paths, the branch. This asks
   * whether the directory is there at all, and it is git's own answer rather
   * than a `stat`: `git worktree list --porcelain` reports `prunable` for an
   * entry whose directory was deleted without git being told, and the adapter
   * has parsed that field since before any caller asked for it.
   *
   * A caller reads this BEFORE a refusal, because the two say different things.
   * A refusal means *do not remove this* and sends an operator to look; a
   * `vanished` answer means *there is nothing to remove and the entry is
   * stale*, and `git worktree prune` is the repair. Measured 2026-09-06: 3 of
   * 20 worktrees here were prunable, and no refusal could see one, since each
   * measures something in a tree that is not there.
   *
   * @param branch - the branch whose worktree to ask about.
   * @returns `present` when a directory is there to read, `vanished` when git
   *   lists one that is gone, and `absent` when git lists none at all.
   */
  presence(branch: string): Promise<PortResult<TreePresence>>;

  /**
   * Whether a worktree holds uncommitted changes or unpushed commits.
   *
   * A tree that cannot be checked reports unclean, so unlanded work stays
   * visible rather than being silently dropped.
   *
   * @param path - the worktree's absolute path.
   * @returns false where the tree holds anything unlanded.
   */
  isClean(path: string): Promise<PortResult<boolean>>;

  /**
   * Lists the marker files a worktree carries at its root.
   *
   * A blocked agent writes a file, so the marker is looked for BY NAME rather
   * than as a string any file may contain — a log that quotes the marker is
   * not a stopped agent.
   *
   * @param path - the worktree's absolute path.
   * @param prefix - the marker's filename prefix, such as `PLOT-BLOCKED`.
   * @returns the matching filenames, without their directory.
   */
  markers(path: string, prefix: string): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the paths a worktree holds on the floor, leftovers dropped.
   *
   * The DIRTY PATHS, where {@link isClean} answers only whether there are any.
   * A monitor comparing two passes needs to know *what* moved, and a boolean
   * that flips from false to false says nothing across a rename.
   *
   * The filter is the operation's reason for existing rather than a
   * convenience on top of it. Three exclusions apply — Plot's own
   * `.plot-worker.` records, editor leftovers (`.tmp1`, `.swp`, `.orig`,
   * `.rej`, `.bak`), and tool scratch directories (`.playwright-mcp`,
   * `.plot/agents`, `.plot/state`, `.omc/state`). A worker monitor appends its
   * findings to a file INSIDE the worktree it watches, so an unfiltered
   * listing would show the monitor's own writing and no two passes could ever
   * agree.
   *
   * Two of the three exclusions match on a nested path, which is why this is
   * not {@link markers}: that one lists a directory's own entries by name
   * prefix and cannot see into `.plot/state` at all.
   *
   * @param path - the worktree's absolute path.
   * @returns the paths, relative to the worktree, without their status codes.
   */
  dirtyPaths(path: string): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the uncommitted paths a desk holds, counted as unlanded work, each
   * still carrying its two-byte `git status --porcelain` status code.
   *
   * NOT {@link dirtyPaths}, which strips the status code for a monitor
   * comparing two passes. The reaper's refusal text names the status a
   * person would see running `git status` themselves — `?? half-done.txt`,
   * not `half-done.txt` — so this keeps what that reading drops. The
   * exclusions differ too: Plot's own `.plot/state` pulse fixture and two
   * named cleanup files, read from the worktree's own `build.mjs` for
   * generated bundles, rather than {@link dirtyPaths}'s worker-record and
   * editor-leftover patterns.
   *
   * @param path - the worktree's absolute path.
   * @returns the porcelain lines, status code and path together.
   */
  dirtyPathsWithStatus(path: string): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the changed and untracked paths a checkout holds under the given
   * pathspecs, with nothing filtered out.
   *
   * {@link dirtyPaths} drops generated bundles and leftovers; this operation
   * reads `git status --porcelain --untracked-files=all` as it stands, so a
   * modified generated bundle is listed.
   *
   * @param path - the checkout's absolute path.
   * @param pathspecs - the paths to read, relative to the checkout.
   * @returns the paths, relative to the checkout, without their status codes.
   */
  changedUnder(path: string, pathspecs: readonly string[]): Promise<PortResult<readonly string[]>>;

  /**
   * Seconds since the newest thing in a desk's tree changed.
   *
   * The newest of HEAD's committer time, each dirty path's mtime, and the
   * mtime of each dirty path's parent below the desk root. The root's own
   * mtime is never read: the loop rewrites its `.plot-worker.*` records there,
   * so reading it would make the loop's bookkeeping look like tree activity.
   *
   * @param path - the worktree's absolute path.
   * @returns the quiet seconds, never negative; null where there is nothing to
   *   read — no directory, or no commit and nothing on the floor. A failure to
   *   observe is not a long silence.
   */
  quietSeconds(path: string): Promise<PortResult<number | null>>;

  /**
   * Whether the branch carries work the agent committed.
   *
   * Counts commits that touched a file between the local `origin/<default>`
   * ref and HEAD. The empty claim commit the dispatcher writes before the
   * agent starts therefore never counts. No network call is made.
   *
   * @param path - the worktree's absolute path.
   * @returns `yes` or `no`; `unanswerable` where the directory is missing, no
   *   `origin/<default>` ref exists, or git cannot count.
   */
  hasCommits(path: string): Promise<PortResult<CommitReading>>;

  /**
   * Whether the branch holds a commit that is not an empty claim marker.
   *
   * Reads every commit from the local `origin/<default>` ref to HEAD and
   * counts the ones {@link isEmptyClaim} does not name a claim, so an empty
   * claim committed on top of earlier work still answers `yes`. Where that
   * range is empty — a branch merged directly, with no PR — HEAD alone
   * answers, so merged work never reads as nothing done. No network call is
   * made.
   *
   * @param path - the worktree's absolute path.
   * @returns `yes` where at least one commit is not a claim marker; `no`
   *   where every commit is; `unanswerable` where the directory is missing,
   *   no `origin/<default>` ref exists, or git cannot list the commits.
   */
  commitBeyondClaim(path: string): Promise<PortResult<CommitReading>>;

  /**
   * How many commits a checkout's HEAD holds that its configured upstream does
   * not: `git rev-list --count @{upstream}..HEAD`, the shell's
   * `desk_reset_refusal` form.
   *
   * @param path - the checkout's absolute path.
   * @returns the count; `failed` where the branch has no upstream configured,
   *   HEAD is detached, or git cannot count.
   */
  aheadOfUpstream(path: string): Promise<PortResult<number>>;

  /**
   * Names the branch a checkout is on.
   *
   * `''` for a detached HEAD, and the emptiness is an ANSWER rather than a
   * failure: several worktrees here are detached, and a reader shown a short
   * sha where a branch name belongs reads it as a branch. A caller that must
   * tell *detached* from *could not be read* reads the result's `ok` — which
   * is the distinction the old `execFileSync` collapsed into one empty string.
   *
   * Distinct from {@link list}, whose entries also carry a branch: this asks
   * about ONE checkout and needs no path comparison to find it. Matching a
   * caller's own root against a listing costs a symlink resolution on every
   * platform where a temporary directory is one.
   *
   * @param path - the checkout's absolute path.
   * @returns the branch name, or `''` where HEAD is detached.
   */
  currentBranch(path: string): Promise<PortResult<string>>;

  /**
   * Names the email git commits under in a checkout — its `user.email`.
   *
   * Asked by path because git resolves the value per checkout: an
   * `includeIf` can set it for one directory and not another.
   *
   * @param path - the checkout's absolute path.
   * @returns the email; `failed` where git has none configured.
   */
  userEmail(path: string): Promise<PortResult<string>>;

  /**
   * Forgets the worktrees whose directories are gone.
   *
   * The one operation here that WRITES, and it writes only to git's own
   * administrative records. A `git worktree add` at a path a stale record still
   * claims is refused, so this runs before one — a caller that skipped it would
   * see the refusal and read it as the path being in use.
   *
   * @returns nothing; a failure means git's records were not updated.
   */
  prune(): Promise<PortResult<void>>;

  /**
   * Creates a worktree at a path, checked out DETACHED.
   *
   * Detached is the contract rather than an option: a caller makes a tree for
   * an agent that will create and check out its own branch there, and a tree
   * already holding one would refuse it.
   *
   * @param path - where to create it, absolute.
   * @param start - the revision to check out.
   * @returns nothing; a failure carries no tree.
   */
  add(path: string, start: string): Promise<PortResult<void>>;

  /**
   * What a checkout reports as changed, VERBATIM.
   *
   * The porcelain text and not a boolean, unlike {@link Trees.isClean}: a
   * caller that caches this compares two readings, and a boolean cannot say a
   * tree changed while staying dirty.
   *
   * @param path - the checkout's absolute path.
   * @returns `git status --porcelain`'s output as it stands.
   */
  statusSync(path: string): PortResult<string>;

  /**
   * Lists the worktrees, read on the CALLING THREAD.
   *
   * The synchronous twin, for the signal that gates a monitor's cache from a
   * synchronous pulse.
   *
   * @returns the worktrees, the main checkout among them.
   */
  listSync(): PortResult<readonly Worktree[]>;

  /**
   * Creates a worktree at a path, checked out on a NAMED branch.
   *
   * `-B`, not `-b`: a leftover branch from an earlier failed run must not block
   * a retry, so the branch is reset to `start` rather than refused for already
   * existing. Distinct from {@link Trees.add}, which checks out detached — a
   * booking run commits ON the branch this creates, where an agent's desk
   * creates its own branch after landing on a detached tree.
   *
   * @param path - where to create it, absolute.
   * @param branch - the branch to create or reset, without a remote prefix.
   * @param start - the revision to branch from.
   * @returns nothing; a failure carries no tree.
   */
  addBranch(path: string, branch: string, start: string): Promise<PortResult<void>>;

  /**
   * Removes a worktree and the branch it was checked out on.
   *
   * ONE OPERATION, not two calls a caller could partially apply. A booking
   * worktree's cleanup is always both together — `git worktree remove` then
   * `git branch -D` — and the shell's own `cleanup()` ignored either failing,
   * because a booking run's cleanup is best-effort: the worktree may already be
   * gone, and nothing downstream depends on it.
   *
   * @param path - the worktree's absolute path.
   * @param branch - the branch to delete, without a remote prefix.
   * @returns nothing; always answers rather than failing, matching the
   *   best-effort cleanup the shell performed.
   */
  removeWithBranch(path: string, branch: string): Promise<PortResult<void>>;

  /**
   * Removes a worktree, leaving the branch it was checked out on untouched.
   *
   * NOT {@link Trees.removeWithBranch} with a flag. That operation is
   * best-effort cleanup of a booking worktree this package created and always
   * owns both halves of; this one is the reaper clearing a desk whose BRANCH
   * is somebody else's lifecycle object — a merged plan's slice, a dispatched
   * agent's work — and deleting it is not this call's business. A reap that
   * reused the two-step operation would delete a branch the ref-deletion rule
   * in `reapable.ts` was never asked about.
   *
   * FORCES, MATCHING THE SHELL'S OWN REMOVAL SITE. A marker file left in an
   * otherwise-landed desk — `PLOT-BLOCKED.md` beside no other uncommitted
   * work — is exactly the uncommitted content `git worktree remove` alone
   * would refuse, and the reaper's own refusals (`firstReapRefusal`) have
   * already decided this tree is safe to clear before this call is reached.
   * A plain, unforced removal would re-litigate that decision at the git
   * level and leave a desk this package already approved removing.
   *
   * @param path - the worktree's absolute path.
   * @returns nothing; a failure means git refused even with `--force` —
   *   the path was not a worktree at all, or a process still holds it.
   */
  removeOnly(path: string): Promise<PortResult<void>>;

  /**
   * Deletes a local branch ref with `git branch -D`. Remote refs are never
   * touched, so the branch stays re-fetchable from the remote.
   *
   * @param branch - the local branch name.
   * @returns nothing; a failure means git refused, such as for a branch a
   *   worktree has checked out or one that does not exist.
   */
  deleteBranch(branch: string): Promise<PortResult<void>>;

  /**
   * The commits on a checkout's `HEAD` that no remote-tracking ref holds,
   * as abbreviated shas, newest first.
   *
   * @param path - the checkout's absolute path.
   * @param exclude - further commits whose ancestors also count as pushed,
   *   such as a merged PR's head.
   * @returns the abbreviated shas; empty where every commit is on a remote.
   *   A failed result where git cannot read the range, such as an `exclude`
   *   entry that names no commit.
   */
  unpushedCommits(path: string, exclude: readonly string[]): Promise<PortResult<readonly string[]>>;

  /**
   * The commits on a checkout's `HEAD` that no remote-tracking ref holds AND
   * whose patch `upstream` does not carry, as abbreviated shas.
   *
   * Compares by patch id (`git cherry`), so a commit whose change a squash
   * merge already took is not listed.
   *
   * @param path - the checkout's absolute path.
   * @param upstream - the ref to compare patches against, such as `origin/main`.
   * @returns the abbreviated shas; a failed result where git cannot read
   *   either range.
   */
  unpushedPatches(path: string, upstream: string): Promise<PortResult<readonly string[]>>;

  /**
   * Resets a desk onto a branch at take-up — `reset_desk`'s common path
   * (`plot-worker-loop.sh:1080`), for the ONE case `agentLoop` emits
   * {@link DeskResetWrite} for: a fresh take-up with `resetRefusals` empty.
   *
   * **PLAIN CHECKOUTS, NEVER `reset --hard` OR `clean -fdx`.** A file the
   * earlier readings missed makes git REFUSE the checkout rather than
   * overwrite it — the write's own second line of defence, matching
   * `decision.ts:374`'s comment exactly.
   *
   * **STEPS, IN THE SHELL'S OWN ORDER:** the previous slice's declaration and
   * correction file are removed (Plot's own bookkeeping, not the work the
   * guard protects); every generated bundle path the desk's own
   * `packages/board/build.mjs` declares — the set `bundle_paths`
   * (`plot-desk-dirt.sh`) reads — is restored from `HEAD` where `HEAD` holds
   * it, or removed where it does not; the base is checked out DETACHED; the
   * branch is created or re-attached.
   *
   * **NOT THE YIELD-AND-RETRY FALLBACK.** Where both checkouts fail — another
   * worktree holds the branch — this answers `failed` and goes no further:
   * that path is `checkoutYield`'s (`rules/checkout-yield.ts`), reached today
   * through `plot-checkout-yield.mjs`, and is out of this write's contract.
   *
   * @param path - the worktree to reset, absolute.
   * @param branch - the branch to check it out onto.
   * @param base - what the branch is cut from when it does not exist locally.
   * @returns nothing; a failure means the checkout was refused — never a
   *   destructive fallback.
   */
  resetOnto(path: string, branch: string, base: string): Promise<PortResult<void>>;

  /**
   * Commits whatever is staged, allowing an empty commit.
   *
   * **`--allow-empty`, MATCHING THE CLAIM.** `git -C <path> commit --allow-empty
   * -m <message>` is the claim commit `agentLoop` emits with `paths: []` — no
   * `git add` runs, because the claim is a marker on the branch rather than a
   * change to it.
   *
   * @param path - the checkout to commit in, absolute.
   * @param message - the commit message.
   * @returns nothing; a failure means git refused the commit.
   */
  commit(path: string, message: string): Promise<PortResult<void>>;

  /**
   * Pushes a branch to `origin` from a checkout, setting the upstream.
   *
   * `git -C <path> push -u origin <branch>`, matching the claim push the loop
   * makes at take-up — `path` is the desk the branch is checked out in, and
   * `branch` is named explicitly rather than read back from the checkout,
   * matching the write's own shape. A push the host rejects is a failed
   * result; whether a rejection means another agent holds the branch is the
   * caller's question (`claimAnswer`), not this operation's.
   *
   * @param path - the checkout to push from, absolute.
   * @param branch - the branch to push.
   * @returns nothing; a failure means the push was rejected or could not run.
   */
  push(path: string, branch: string): Promise<PortResult<void>>;

  /**
   * Stages one or more paths in a checkout's index.
   *
   * `git -C <path> add -- <pathspecs>` — a lifecycle write stages the plan
   * file, the hold file and the sprint file it edited before asking
   * {@link hasStagedChanges} and committing. A pathspec naming a file that was
   * deleted stages the deletion, matching plain `git add`'s own behaviour.
   *
   * @param path - the checkout to stage in, absolute.
   * @param pathspecs - the paths to stage, repository-relative to `path`.
   * @returns nothing; a failure means git refused to stage one of them.
   */
  stage(path: string, pathspecs: readonly string[]): Promise<PortResult<void>>;

  /**
   * Whether a checkout holds no staged changes.
   *
   * `git -C <path> diff --cached --quiet` — a lifecycle write stages a plan
   * edit and then asks this before committing, to answer `nothing-to-commit`
   * without a commit that would carry no change. Unstaged and untracked
   * changes outside the index answer nothing here; a caller that cares about
   * them stages first.
   *
   * @param path - the checkout to check, absolute.
   * @returns `true` when the index holds nothing staged; a failure means git
   *   could not be asked.
   */
  hasStagedChanges(path: string): Promise<PortResult<boolean>>;

  /**
   * Commits whatever is staged, attributing the commit to `who`.
   *
   * **NOT {@link commit}.** That operation is `--allow-empty` with no author
   * override, matching the claim marker it exists for. This one fails on an
   * empty index — the caller already asked {@link hasStagedChanges} — and
   * sets `user.name` for the one commit rather than the checkout's identity,
   * matching a lifecycle write's `git -C <path> -c user.name=<who> commit -q
   * -m <message>`.
   *
   * @param path - the checkout to commit in, absolute.
   * @param who - the name to attribute the commit to.
   * @param message - the commit message.
   * @returns nothing; a failure means git refused the commit.
   */
  commitAs(path: string, who: string, message: string): Promise<PortResult<void>>;
}
