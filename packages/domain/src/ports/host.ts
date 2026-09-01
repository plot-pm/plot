import type { PortResult } from '../port-result.js';
import type { Pr } from '../entities/pr.js';
import type { Issue } from '../entities/issue.js';
import type { LimitReading } from '../entities/limit.js';

/** Which host CLI answers — the backend `plot-host.sh` resolved. */
export type HostBackend = 'github' | 'bitbucket';

/**
 * A PR lookup's answer, where finding nothing is an answer.
 *
 * `null` means the host was asked and holds no PR for this branch, which is a
 * different fact from a lookup that failed — the latter is a `PortResult`
 * failure and never reaches this type.
 */
export type PrLookup = Pr | null;

/**
 * Whether the host merged any PR for a branch.
 *
 * Three values, because a host that cannot be asked must not answer
 * `not-merged`: every caller of this question is deciding whether to remove
 * something, and silence is never permission.
 */
export type MergedAnswer = 'merged' | 'not-merged' | 'unknown';

/**
 * What a call observed about the host's willingness to answer.
 *
 * `throttled` is the word `plot-host.sh` already classifies stderr into — a
 * rate limit, primary or secondary. It is evidence about the real ceiling, and
 * the only evidence a connector with no limit API ever gets.
 */
export type LimitObservation = 'ok' | 'throttled';

/**
 * What opening a PR needs to be told.
 *
 * The base is optional because the host already knows its default branch, and a
 * caller that had to name it would be a caller holding a fact the connector
 * holds better. `draft` is likewise omitted rather than defaulted: a PR opened
 * on a finding is asking to be read, and a draft is the one shape a reviewer
 * will not be notified about.
 */
export interface PrCreateRequest {
  /** The branch to open from; it must already exist on the host. */
  head: string;
  /** The PR's title. */
  title: string;
  /** The PR's body. */
  body: string;
  /** The branch to merge into; the host's default when `''`. */
  base?: string;
}

/**
 * Reads the git host — the FOREIGN source of truth about PRs, builds, issues.
 *
 * Foreign state carries its askability apart from its answer, which is why
 * every operation returns a `PortResult`: a Bitbucket repo with a disabled
 * tracker is permanently `unaskable`, while an expired token is a `failed`
 * call that will succeed once somebody logs in.
 *
 * The issue operations read and never write. Plot's record of an issue is the
 * plan that references it; a copy of tracker state ages into a lie.
 *
 * THIS PORT IS THE ONE CONNECTOR. Of nine adapters exactly one reaches a remote
 * service with an account, credentials and a rate limit behind it; the rest
 * read git, the process table and the filesystem, where none of those exist. So
 * the limit question below belongs here and must not be lifted onto every
 * adapter — a filesystem port has no budget to report.
 *
 * AND IT STILL NAMES NO TRANSPORT, NO ACCOUNT AND NO BUCKET. Every operation is
 * a question; which API answers it, under whose credentials, against which
 * bucket, is the adapter's own business. That is the property that makes adding
 * GitLab an adapter change rather than a domain change, and `limit` keeps it:
 * it does not take a bucket, it reports the ones the connector has.
 */
export interface Host {
  /**
   * Names the resolved backend.
   *
   * @returns `github` or `bitbucket`.
   */
  backend(): Promise<PortResult<HostBackend>>;

  /**
   * Reads one PR, by number or by branch.
   *
   * @param ref - a PR number, or the branch a PR would belong to.
   * @returns the PR, or null where the host holds none for this ref.
   */
  prState(ref: string | number): Promise<PortResult<PrLookup>>;

  /**
   * Whether the host merged ANY PR for this branch.
   *
   * Reads the merge timestamp rather than the state — a merged PR reports
   * `CLOSED` — and asks about every PR on the branch rather than the newest,
   * because a newer unmerged PR in front of a real merge would otherwise
   * report the branch's work as unlanded.
   *
   * @param branch - the branch to ask about.
   * @returns `merged`, `not-merged`, or `unknown` where the host could not say.
   */
  prMerged(branch: string): Promise<PortResult<MergedAnswer>>;

  /**
   * Opens a PR for a branch.
   *
   * THE ONE WRITE ON THIS PORT, and the reason it is allowed here while
   * merging, reaping and killing are not is reversibility: a PR opened wrongly
   * is closed by whoever disagrees, and the branch, the worktree and the work
   * are untouched. Nothing else a fleet could do to a branch has that property.
   *
   * The head branch must already be pushed — this asks the host about refs the
   * host can see, and a branch that exists only on the machine has nothing to
   * open a PR from.
   *
   * @param request - the branch, the title and the body to open with.
   * @returns the PR's URL as the host printed it; `''` where the host opened
   *   one and said nothing about where it is.
   */
  prCreate(request: PrCreateRequest): Promise<PortResult<string>>;

  /**
   * Lists PRs.
   *
   * @param state - `open`, `merged`, `closed`, or `all`.
   * @param limit - how many to ask for; the host's own page size when omitted.
   * @returns the PRs, newest first.
   */
  prList(state: string, limit?: number): Promise<PortResult<readonly Pr[]>>;

  /**
   * Lists the tracker's open issues, without their bodies.
   *
   * The body is omitted because this runs on a timer for every open issue, and
   * a body per issue per refresh buys nothing a caller needs to decide whether
   * an issue is worth a plan.
   *
   * @param limit - how many to ask for.
   * @returns the issues; `unaskable` where the host has no tracker at all.
   */
  issueList(limit?: number): Promise<PortResult<readonly Issue[]>>;

  /**
   * Reads one issue, with its body.
   *
   * Fetched per click rather than per refresh: the body is what a person reads
   * to decide, so its cadence is a human's.
   *
   * @param id - the issue's identifier, opaque: GitHub yields `226` and Jira
   *   yields `PROJ-123`, and only one is a number by accident of the host.
   * @returns the issue; `unaskable` where the host has no tracker at all.
   */
  issueView(id: string): Promise<PortResult<Issue>>;

  /**
   * What is this connector's limit, and how well does it know it?
   *
   * One reading per bucket the connector meters, each tagged `actual` where the
   * connector reported it, `predicted` where the adapter supplied a value from
   * experience, and `unknown` where it reports nothing and has nothing to
   * predict. **The adapter is the only place that could know**, which is what
   * removes the need for a connector table in Plot or a probe at setup.
   *
   * A `predicted` reading is `answered`, not `failed`. The adapter is not
   * breaking; it is telling the truth about what it knows.
   *
   * An empty list is an answer — this connector meters nothing. It is not
   * `free`: a caller reads the basis, and there is no reading to read.
   *
   * @returns one reading per bucket; `unaskable` where the connector cannot be
   *   asked at all.
   */
  limit(): Promise<PortResult<readonly LimitReading[]>>;

  /**
   * Records what a call observed, so a wrong prediction corrects itself.
   *
   * THE PIECE A STATIC DEFAULT CANNOT HAVE. A `throttled` refusal is evidence
   * the prediction was too high, and it lowers the value `limit` reports for
   * the rest of the session. A number shipped in Plot is stale the moment a
   * vendor changes it; a number corrected by the refusal it caused cannot be.
   *
   * Only a `predicted` reading moves. An `actual` one is what the connector
   * itself said, and overwriting a measurement with an inference from a burst
   * refusal would lose the measurement.
   *
   * The correction is the SESSION's — held in the adapter, gone when the
   * process ends. Where it is persisted is another slice's question.
   *
   * @param observed - what the call saw: `throttled` is the refusal.
   */
  observe(observed: LimitObservation): void;
}
