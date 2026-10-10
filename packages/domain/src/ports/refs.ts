import type { PortResult } from '../port-result.js';
import type { FleetReading } from '../entities/fleet.js';
import type { RemoteTipReading } from '../rules/checks-verdict.js';

/**
 * Whether a branch's work is on the default branch.
 *
 * Three values, never a boolean. A scan that could not fetch reads merged
 * branches as open, and `unknown` is what keeps that from being reported as a
 * claim about the branch.
 */
export type MergeStatus = 'merged' | 'not-merged' | 'unknown';

/**
 * One entry of a tree listing — a blob, with the mode that says what it is.
 *
 * The mode is carried rather than filtered out because a symlink and a file
 * are both blobs to git, and telling them apart is the caller's question: a
 * `120000` entry holds its target's PATH as its content, so a reader that
 * parsed one would be handed a line of text where a file should be.
 */
export interface TreeBlob {
  /** The six-digit git mode — `100644`, `100755`, `120000`. */
  mode: string;
  /** The blob's object name. */
  sha: string;
  /** The path, relative to the repository root. */
  path: string;
}

/** A branch and the commit its tip points at. */
export interface BranchTip {
  /** The branch name, without a remote prefix. */
  branch: string;
  /** The commit the tip resolves to. */
  sha: string;
}

/**
 * Whether a branch's remote-tracking ref existed at the last fetch.
 *
 * Three values, never a boolean: `unknown` is a call that failed, and it
 * proves neither presence nor absence — the caller that asks at hand-over time
 * must not read a failed call as `absent` and offer branch work nobody could
 * verify is finished.
 */
export type RemoteHeadAnswer = 'present' | 'absent' | 'unknown';

/**
 * What {@link Refs.remoteSha} read: the commit a remote branch points at, or
 * `unknown` where the read could not say.
 */
export type RemoteShaReading = { readonly sha: string } | 'unknown';

/** One ref and the object it points at, as a signal reads the pair. */
export interface RefState {
  /** The full ref name, such as `refs/remotes/origin/main`. */
  ref: string;
  /** The object the ref resolves to. */
  sha: string;
}

/** A branch and when its tip was committed. */
export interface BranchDate {
  /** The branch name, without a remote prefix. */
  branch: string;
  /** The tip's committer date, as epoch seconds. */
  committedAt: number;
}

/** One commit, as a short log line reports it. */
export interface CommitLine {
  /** The abbreviated object name. */
  sha: string;
  /** The subject line. */
  subject: string;
}

/**
 * One commit, as {@link Refs.commitSubjects} reports it — carrying what the
 * claim vocabulary needs and no classification of it.
 *
 * **STRUCTURALLY A {@link CommitReading} WITH A TIME ADDED**, so a caller may
 * hand this array straight to `realCommits`/`isEmptyClaim` without mapping it.
 */
export interface CommitSubject {
  /** The commit's committer time, epoch milliseconds. */
  at: number;
  /** The commit's subject line. */
  subject: string;
  /** The commit's tree id. */
  tree: string;
  /**
   * The tree id of the commit's first parent, or `null` where the commit has
   * no parent or the parent's tree could not be read.
   */
  parentTree: string | null;
}

/** One merge commit, as a merges walk reports it. */
export interface MergeCommit {
  /** The full object name. */
  sha: string;
  /** The subject line, unparsed. */
  subject: string;
}

/**
 * Whether one commit is contained in another.
 *
 * Three values, never a boolean: `unknown` is a test git could not run, and it
 * proves nothing in either direction.
 */
export type Containment = 'yes' | 'no' | 'unknown';

/**
 * Which refs a state reading covers.
 *
 * `remote` is `origin` alone rather than every remote, because that is the
 * remote Plot derives branch state from — a fork's second remote moves for
 * reasons no Plot answer depends on, and hashing it would report an estate
 * change that changes nothing.
 */
export type RefScope = 'local' | 'remote' | 'both';

/**
 * Reads git refs — the DERIVED source of truth about branches.
 *
 * Every answer here comes from refs rather than from the host: a ref is local
 * evidence, so it survives an unreachable host, and it is why `Refs` and
 * `Host` are separate ports rather than one.
 */
export interface Refs {
  /**
   * Names the repository's default branch.
   *
   * @returns the branch name, such as `main`.
   */
  defaultBranch(): Promise<PortResult<string>>;

  /**
   * Lists the branches the repository holds.
   *
   * @param remote - when true, list `origin/*` rather than local branches.
   * @returns the branch names, without their remote prefix.
   */
  listBranches(remote: boolean): Promise<PortResult<readonly string[]>>;

  /**
   * Whether a branch is an ancestor of the default branch.
   *
   * Ancestry alone never clears a squash-merged branch — the rewrite leaves it
   * permanently ahead of the default branch — so a `not-merged` answer here is
   * evidence and not a verdict.
   *
   * @param branch - the branch to test.
   * @returns `merged`, `not-merged`, or `unknown` when the refs cannot be read.
   */
  isMergedByAncestry(branch: string): Promise<PortResult<MergeStatus>>;

  /**
   * Resolves a ref to its commit sha.
   *
   * @param ref - any revision git accepts.
   * @returns the full sha.
   */
  resolve(ref: string): Promise<PortResult<string>>;

  /**
   * Lists the files a branch changed against the default branch.
   *
   * @param branch - the branch to read.
   * @returns the paths, relative to the repository root.
   */
  changedFiles(branch: string): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the paths the working tree changes against HEAD: modified, staged,
   * and untracked files. A renamed file is listed by its new path.
   *
   * @returns the paths, relative to the repository root.
   */
  workingChanges(): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the tracked files under the pathspecs that contain a fixed string.
   *
   * @param term - the text to find, matched literally.
   * @param globs - path globs to search under; `*` within one segment, `**` across.
   * @returns the matching paths, relative to the repository root; empty when none match.
   */
  filesNaming(term: string, globs: readonly string[]): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the paths whose `merge` attribute is unset (`-merge` in
   * `.gitattributes`), which this estate uses to mark generated files.
   *
   * @param paths - the paths to test.
   * @returns the subset with `merge` unset.
   */
  mergeUnset(paths: readonly string[]): Promise<PortResult<readonly string[]>>;

  /**
   * Lists the files ONE COMMIT changed against its first parent.
   *
   * THE MERGE COMMIT, NOT THE BRANCH, and that is the whole reason this sits
   * beside {@link changedFiles} rather than being expressed through it. A
   * squash-merged branch loses its ref at merge — measured on both slices that
   * shipped empty on 2026-09-08 — so `origin/main...branch` cannot run for the
   * population this question is asked about. The merge commit survives.
   *
   * @param sha - the commit to read; any revision git accepts.
   * @returns the paths it changed, relative to the repository root. An empty
   *   list is an ANSWER: a commit that changed nothing. A commit that cannot be
   *   read is a failed result, never an empty one.
   */
  commitFiles(sha: string): Promise<PortResult<readonly string[]>>;

  /**
   * Reads the fleet's whole state in one pass.
   *
   * The expensive operation on this port, and deliberately one call: the scan
   * derives every plan's slice verdicts together, and asking per plan would
   * re-walk the same refs once per plan.
   *
   * @returns the pulse, as the scan derives it.
   */
  pulse(): Promise<PortResult<FleetReading>>;


  /**
   * Lists the blobs a tree holds beneath a path.
   *
   * Returns the MODE and the SHA alongside each path, because both are answers
   * the same listing already carries and asking for them separately would cost
   * a second read per entry. The mode separates a file from the symlink
   * pointing at it; the sha is what {@link readBlobs} is given.
   *
   * @param ref - the revision to list at.
   * @param dir - the path to list beneath, relative to the repository root.
   * @returns the blobs, or a failure when the ref cannot be read.
   */
  listBlobs(ref: string, dir: string): Promise<PortResult<readonly TreeBlob[]>>;

  /**
   * Reads many blobs by object name, in ONE read.
   *
   * Batched deliberately, and the batch is the contract rather than an
   * optimisation of it: a git call costs ~55 ms of process spawn regardless of
   * how little work it does, so a per-object implementation of this signature
   * would cost that once per blob. Measured on this repository 2026-08-27:
   * ~1.5 s for a per-file loop against 0.011 s for one batch, 136x apart.
   *
   * A sha the repository does not hold is simply absent from the map — a
   * missing object is a reading, not a failure of the call.
   *
   * @param shas - the object names to read.
   * @returns each readable blob's content, keyed by its sha.
   */
  readBlobs(shas: readonly string[]): Promise<PortResult<ReadonlyMap<string, string>>>;

  /**
   * Lists remote-tracking branches matching ref patterns, with their tip shas.
   *
   * The tip comes back in the SAME listing as the name because it is free
   * there, and it is what lets a caller skip work when no branch has moved.
   *
   * @param patterns - full ref patterns, such as `refs/remotes/origin/idea/*`.
   * @returns the branches, without their `origin/` prefix.
   */
  branchTips(patterns: readonly string[]): Promise<PortResult<readonly BranchTip[]>>;

  /**
   * Names the repository this ref reader is reading.
   *
   * Answers where git resolved to, which need not be where the caller pointed
   * it: git searches UPWARDS from a directory, so a plans directory nested in
   * an unrelated checkout resolves to that checkout. A caller comparing this
   * against its own root is asking whether it is reading the repository it
   * meant to.
   *
   * @returns the repository's top-level path.
   */
  repoRoot(): Promise<PortResult<string>>;

  /**
   * How many commits the checkout's HEAD is behind a ref.
   *
   * `null` where the question has no answer rather than a count, and the
   * distinction is the whole of it: a detached HEAD parked at the ref's tip
   * reports 0 commits behind, which is indistinguishable from a current
   * branch. So HEAD is tested for being a branch FIRST, and the count is taken
   * only once the question is known to be answerable.
   *
   * @param ref - the revision to measure against.
   * @returns the count, or null where HEAD is not a branch.
   */
  countBehind(ref: string): Promise<PortResult<number | null>>;

  /**
   * Reads a file's content at a ref, without checking it out.
   *
   * A phase read from `origin/<main>` is the gate `plot-phase-gate.sh` applies,
   * and it is a different question from the working tree's copy: an approval
   * nobody else can see is not one.
   *
   * @param ref - the revision to read at.
   * @param path - the file's path, relative to the repository root.
   * @returns the file's content.
   */
  showFile(ref: string, path: string): Promise<PortResult<string>>;

  /**
   * Whether git can be asked about this directory at all.
   *
   * A caller standing in a plain directory has no refs, no worktrees and no
   * remote — an ordinary case here, because every unit test builds one. It is a
   * different answer from *the repository could not be read*: the first says
   * there is nothing to ask, the second that the asking failed.
   *
   * @returns true where a git directory resolves.
   */
  isRepository(): Promise<PortResult<boolean>>;

  /**
   * Every ref and the object it points at.
   *
   * The SHA rather than the ref name, because a branch force-pushed between
   * two readings keeps its name and is a different estate. A caller comparing
   * two of these is asking whether anything moved.
   *
   * @param scope - which refs to read: local heads, remotes, or both.
   * @returns each ref with its object name, in git's order.
   */
  refState(scope: RefScope): Promise<PortResult<readonly RefState[]>>;

  /**
   * Every ref and its object, read on the CALLING THREAD.
   *
   * The synchronous twin, for the signals that gate a monitor's own cache and
   * are called from a synchronous pulse. The measurement that licenses it:
   * 275 refs in 0.007 s on this repository.
   *
   * @param scope - which refs to read.
   * @returns each ref with its object name.
   */
  refStateSync(scope: RefScope): PortResult<readonly RefState[]>;

  /**
   * How many commits a local branch holds that its remote does not.
   *
   * `refs/remotes/origin/<branch>..refs/heads/<branch>`, both endpoints named
   * explicitly. A branch with no local ref, no upstream, or an unreadable ref
   * database is a failed reading rather than a zero one — the two differ in
   * exactly the direction a caller renders, and zero reads as *nothing to
   * push*.
   *
   * @param branch - the branch to measure.
   * @returns the count.
   */
  countAheadSync(branch: string): PortResult<number>;

  /**
   * Hashes files as git objects, in ONE call.
   *
   * `hash-object --stdin-paths`, and the batch is the contract: 164 plans in
   * 0.014 s measured, against a spawn per file. It ABORTS at the first
   * unreadable path having already printed the oids before it, so a partial
   * answer is a failure of the call and never a short list a caller could
   * mistake for a complete one.
   *
   * @param paths - the paths to hash, relative to the repository root.
   * @returns each path's object name, keyed by the path as given.
   */
  hashFilesSync(paths: readonly string[]): PortResult<ReadonlyMap<string, string>>;

  /**
   * The newest commit on `HEAD` that changed a path.
   *
   * @param path - the path, relative to the repository root.
   * @returns the full sha; `''` where no commit on `HEAD` changed the path.
   */
  lastCommitTouching(path: string): Promise<PortResult<string>>;

  /**
   * Whether a ref holds an object at a path.
   *
   * `cat-file -e`, which answers without reading the content — the question is
   * presence, and a caller that fetched the blob to find out would pay for
   * bytes it discards.
   *
   * @param ref - the revision to look in.
   * @param path - the path, relative to the repository root.
   * @returns true where the object is there.
   */
  fileExistsSync(ref: string, path: string): PortResult<boolean>;

  /**
   * Lists remote branches with the date their tips were committed.
   *
   * The date arrives in the SAME listing as the name because it is free there,
   * which is the reason this is not two calls.
   *
   * @param patterns - full ref patterns, such as `refs/remotes/origin`.
   * @returns each branch with its tip's committer date.
   */
  branchDates(patterns: readonly string[]): Promise<PortResult<readonly BranchDate[]>>;

  /**
   * Lists the remote branches NOT merged into a ref.
   *
   * Ancestry, so a squash-merged branch reports unmerged here — the same
   * evidence {@link Refs.isMergedByAncestry} carries, and for the same reason
   * it is evidence rather than a verdict.
   *
   * @param ref - the revision to test against.
   * @returns the branch names, without their remote prefix.
   */
  unmergedBranches(ref: string): Promise<PortResult<readonly string[]>>;

  /**
   * The URL a remote fetches from.
   *
   * @param remote - the remote's name, such as `origin`.
   * @returns the configured URL.
   */
  remoteUrl(remote: string): Promise<PortResult<string>>;

  /**
   * The most recent commits in a range, newest first.
   *
   * Merges are excluded: a briefing wants what was written, and a merge commit
   * names no work of its own.
   *
   * @param dir - the checkout to read, absolute; its own refs, not the board's.
   * @param range - any range git accepts, such as `main..HEAD`.
   * @param max - how many commits to read at most.
   * @returns the commits, newest first.
   */
  commitsSync(dir: string, range: string, max: number): PortResult<readonly CommitLine[]>;

  /**
   * Every commit in a range, with its time, subject, tree and first parent's
   * tree — newest first, merges included.
   *
   * **NOT {@link Refs.commitsSync}.** That method is synchronous, excludes
   * merges, and reports `{ sha, subject }` only — other callers read its
   * `CommitLine` shape, and widening it would change their answer too. This is
   * a second method beside it rather than a wider one.
   *
   * **IT DECIDES NOTHING ABOUT THE COMMITS.** It answers what git recorded;
   * whether a commit is a claim marker is {@link isEmptyClaim}'s question, read
   * through `tree` and `parentTree`.
   *
   * **`parentTree` IS `null`, NOT EMPTY, where the first parent's tree cannot
   * be read** — a root commit, or a boundary this range's walk did not reach.
   * Absent is not false: a caller that read it as empty would count a commit
   * with a missing reading as a claim marker.
   *
   * @param range - any range git accepts, such as `origin/main..origin/<branch>`.
   * @returns the commits, newest first; empty for a range with none. A failed
   *   result for a range git could not read, such as one naming a ref that
   *   does not exist.
   */
  commitSubjects(range: string): Promise<PortResult<readonly CommitSubject[]>>;

  /**
   * The commit that first added each file under a directory, on one ref.
   *
   * A renamed file maps to the commit that added its ORIGINAL path, so a
   * retitled file keeps its first age. A file whose rename chain ends in no
   * add inside the walk is absent from the answer.
   *
   * @param ref - the revision to walk, such as `origin/main`.
   * @param dir - the directory, relative to the repository root.
   * @returns each file's repository-relative path to its adding commit.
   */
  planAdditions(ref: string, dir: string): Promise<PortResult<ReadonlyMap<string, string>>>;

  /**
   * The merge commits on a ref, newest first.
   *
   * @param ref - the revision to walk, such as `origin/main`.
   * @param max - how many merges to read at most.
   * @returns each merge's full hash and subject.
   */
  mergeSubjects(ref: string, max: number): Promise<PortResult<readonly MergeCommit[]>>;

  /**
   * Whether one commit is an ancestor of another.
   *
   * Evidence, not a verdict: the caller decides what containment means.
   *
   * @param ancestor - the commit that may be contained.
   * @param descendant - the commit that may contain it.
   * @returns `yes`, `no`, or `unknown` where git could not answer.
   */
  contains(ancestor: string, descendant: string): Promise<PortResult<Containment>>;

  /**
   * Whether the branch's last-fetched remote-tracking ref,
   * `refs/remotes/origin/<branch>`, exists.
   *
   * **A LOCAL READ, NOT A NETWORK CALL.** The answer is only as current as the
   * last fetch, which the scan makes on its own timer. It reaches neither the
   * remote nor the host, so it spends no host rate limit.
   *
   * @param branch - the branch to ask about, without a remote prefix.
   * @returns `present` where the ref resolves to a commit; `absent` where no
   *   such ref exists; `unknown` where git could not answer.
   */
  remoteHead(branch: string): Promise<PortResult<RemoteHeadAnswer>>;

  /**
   * Lists the `vX.Y.Z` tags containing a commit, sorted by VERSION.
   *
   * **VERSION ORDER, NOT GIT'S OWN.** `git tag --contains` lists in no
   * dependable order, and the release that shipped a commit is the FIRST tag
   * by version among them — a later tag containing the same commit is a later
   * release that happens to still carry it, not the one that shipped it first.
   * A caller sorting this itself would be a second place reimplementing
   * version order.
   *
   * Only tags matching `v<major>.<minor>.<patch>` exactly are returned; any
   * other tag the commit is reachable from is not a release and is excluded.
   *
   * @param sha - the commit to test.
   * @returns the matching tags, oldest version first; empty where none contain
   *   it.
   */
  tagsContaining(sha: string): Promise<PortResult<readonly string[]>>;

  /**
   * The date a tag's commit was made, as `YYYY-MM-DD`.
   *
   * @param tag - the tag name.
   * @returns the committer date; a failure where the tag does not resolve.
   */
  tagDate(tag: string): Promise<PortResult<string>>;

  /**
   * Whether a branch's tip on the remote still equals a commit, read live.
   *
   * **`git ls-remote`, NOT {@link Refs.remoteHead} or {@link Refs.branchTips}.**
   * Both of those read the LAST-FETCHED `refs/remotes/origin/*`, so after a
   * person pushes on top of the agent's commit (#1199: `0e64fafd` over the
   * agent's `f743e573`) they still report the agent's own tip. This asks the
   * remote directly, which is the only reading that can see a push nobody here
   * has fetched yet.
   *
   * **THE COMPARISON IS EQUALITY, NOT ANCESTRY**, so it carries no
   * `plot-ancestry` declaration: `other` means a DIFFERENT commit sits at the
   * tip, whether or not it descends from the one pushed, and that is itself the
   * fact the loop's CI wait acts on — a settled run for the old tip is not
   * evidence about a tip that moved.
   *
   * @param branch - the branch to ask about, without a remote prefix.
   * @param pushedSha - the commit the caller pushed.
   * @returns `unaskable` from the board's instance (`refs-git.ts` holds no
   *   network call; the loop composes `refs-remote-git.ts` onto it), otherwise
   *   `pushed` where the remote tip still equals it, `other` where a
   *   different commit sits there now, and `unknown` where the read failed or
   *   timed out — never `other` for that case, because a failure to observe is
   *   not evidence the tip moved.
   */
  remoteTip(branch: string, pushedSha: string): Promise<PortResult<RemoteTipReading>>;

  /**
   * Fetches a branch from `origin`, then answers whether origin holds it.
   *
   * `git fetch -q origin <branch>`; where the fetch fails,
   * `git ls-remote --heads origin refs/heads/<branch>`. The order is the one
   * `plot-worker-loop.sh` uses after a rejected claim push. A successful fetch
   * also updates `refs/remotes/origin/<branch>`, so a later
   * {@link Refs.commitSubjects} over it reads what origin holds now.
   *
   * @param branch - the branch to ask about, without a remote prefix.
   * @returns `unaskable` from the board's instance, which holds no network
   *   call; otherwise `present` where the fetch succeeded, `absent` where it
   *   failed and `ls-remote` answered with no such ref, and `unknown` where
   *   neither call answered.
   */
  fetchRemoteHead(branch: string): Promise<PortResult<RemoteHeadAnswer>>;

  /**
   * The commit a branch points at on `origin`, read live.
   *
   * **`git ls-remote origin refs/heads/<branch>`, THE FULL REF MATCHED.** A bare
   * `main` pattern also lists `refs/heads/feature/main`, whose tip says nothing
   * about `main`. This is the one call the default-branch reading makes per
   * refresh, and it asks the remote rather than the last fetch for the reason
   * {@link Refs.remoteTip} does.
   *
   * @param branch - the branch to ask about, without a remote prefix.
   * @returns `unaskable` from the board's instance (`refs-git.ts` holds no
   *   network call; fleetd composes `refs-remote-git.ts` onto it); otherwise the
   *   sha, or `unknown` where the read failed, timed out or found no such
   *   branch.
   */
  remoteSha(branch: string): Promise<PortResult<RemoteShaReading>>;
}
