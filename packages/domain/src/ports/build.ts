import type { BuildRun, ShaRun } from '../entities/build.js';
import type { LimitReading } from '../entities/limit.js';
import type { PortResult } from '../port-result.js';

/**
 * Which CI system answers — the system a repository declared, in its own word.
 *
 * Unvalidated, like the git host's backend word and the tracker's scheme. The
 * domain holds no list of CI vendors, so a pipeline it has never heard of
 * reaches the connector that might drive it rather than being refused by a
 * type.
 *
 * `''` is a repository that declared none, and it is a real value rather than
 * an absence: a repository whose branches trigger no build is a fact worth
 * answering with, not a question to route somewhere.
 */
export type BuildSystem = string;

/**
 * Reads the build pipeline — the FOREIGN source of truth about what ran.
 *
 * A CI SYSTEM IS NOT A GIT HOST. `CI` is a `## Plot Config` key declared
 * independently of `Git host`, so a team whose code lives on Bitbucket and
 * whose builds run on Jenkins has two remote services. Asking the git host
 * about builds made this repository's accident — GitHub is both — into the
 * shape of the interface: `plot-host.sh`'s `runs` arm holds one `gh` call and
 * no other vendor, so a Bitbucket team's check column was not wrong but
 * ABSENT, and an absence rendered as *no checks* is the one failure the
 * estate's own rule forbids.
 *
 * EVERY IMPLEMENTATION IS A CONNECTOR. A CI system is a remote service with an
 * account, credentials, a rate limit and a transport choice, which is what
 * separates a connector from an adapter reaching the local machine. Each
 * implementation owns its OWN budget: GitHub Actions minutes are a quota
 * distinct from the API's, and a Jenkins controller's tolerance is neither.
 *
 * THREE OPERATIONS, AND THEY ARE THE THREE THAT ALREADY EXISTED. `runs` and
 * `run-for-sha` are `plot-host.sh` arms; `ci-limit` is the third, and the
 * script's own comment already called it *"a separate axis"*. Nothing is
 * invented here — what moves is which port declares them.
 *
 * IT NAMES NO TRANSPORT, NO ACCOUNT AND NO BUCKET, exactly as the git host
 * port does not. Which API answers, under whose credentials, against which
 * bucket, is the connector's own business — the property that makes adding a
 * third CI system a connector rather than a domain change.
 */
export interface BuildPort {
  /**
   * Names the CI system this connector answers as.
   *
   * @returns the system's own word; `''` where the repository declared none.
   */
  system(): BuildSystem;

  /**
   * Lists one branch's recent runs, newest first.
   *
   * FACTS, NEVER A VERDICT. Nothing here compares runs or calls one transient;
   * the history is evidence a reader concludes from. What proved a `403`
   * transient on 2026-08-17 was the same branch running green two minutes
   * earlier, and a real failure presents identically in every other respect.
   *
   * METERED, so a caller asks only where the question arises — a branch whose
   * PR already reports failing checks. One request per such branch.
   *
   * AN EMPTY LIST IS AN ANSWER, and a different one from `unaskable`. A CI
   * system that was asked and holds no run for this branch has answered; a
   * repository that declared no CI at all cannot be asked, and the board
   * renders the two differently.
   *
   * @param branch - the branch to read the history of.
   * @param limit - how many runs to ask for; the connector's own default when
   *   omitted.
   * @returns the runs, newest first; `unaskable` where there is no CI to ask.
   */
  runs(branch: string, limit?: number): Promise<PortResult<readonly BuildRun[]>>;

  /**
   * Reads the run for ONE commit, or the branch's newest where it has none.
   *
   * PINNED TO A SHA, which is the whole reason it exists beside {@link runs}.
   * A branch pushed twice in quick succession has the first sha's run
   * finishing after the second sha's started, so a branch-scoped history
   * cannot say which commit an answer is about — and a green result for
   * superseded code is worse than no result, because it invites a merge of the
   * wrong thing. Measured 2026-08-30: two merge waiters reported on superseded
   * runs and had to be stopped and re-armed.
   *
   * IT FALLS BACK RATHER THAN REPORTING NOTHING, and says which run it found.
   * Filtering to the asked-for sha and stopping makes the most important case
   * invisible: a run in flight for a commit the branch has moved past would
   * report identically to no run at all. The answer's own `sha` is what tells
   * a caller which of the two it is holding.
   *
   * `null` IS AN ANSWER — the branch has no runs at all, which is what a
   * caller polling a fresh push sees on every pass until CI wakes up.
   *
   * @param branch - the branch the run belongs to.
   * @param sha - the commit to ask about.
   * @param limit - how many runs to search among; the connector's own default
   *   when omitted.
   * @returns the run, or null where the branch has none; `unaskable` where
   *   there is no CI to ask.
   */
  runForSha(branch: string, sha: string, limit?: number): Promise<PortResult<ShaRun | null>>;

  /**
   * What is this connector's limit, and how well does it know it?
   *
   * ITS OWN, and that is why the operation is here rather than borrowed from
   * the git host. A repository's CI and its git host are two services with two
   * accounts and two windows; a caller reading one connector's headroom to
   * pace calls against the other spends a budget it never measured.
   *
   * One reading per bucket the connector meters, each tagged `actual` where
   * the connector reported it, `predicted` where the connector supplied a
   * value from experience, and `unknown` where it reports nothing and has
   * nothing to predict. A `predicted` reading is `answered`, not `failed` —
   * the connector is telling the truth about what it knows.
   *
   * An empty list is an answer — this connector meters nothing. It is not
   * `free`: a caller reads the basis, and there is no reading to read.
   *
   * @returns one reading per bucket; `unaskable` where there is no CI to ask.
   */
  limit(): Promise<PortResult<readonly LimitReading[]>>;

  /**
   * Why the most recent call did not answer, or null where it did.
   *
   * The sentence `PortResult` cannot carry. A connector's refusal has a
   * DURATION in it, and the connector is the only place that sentence exists.
   *
   * Set by every operation on this port, so a caller reads it immediately
   * after the call it is about and never later. It is the SESSION's, held in
   * the connector and gone when the process ends.
   *
   * @returns the last refusal, verbatim, or null where the last call answered.
   */
  lastRefusal(): string | null;
}
