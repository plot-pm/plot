import type { PortResult } from '../port-result.js';
import type { Pr } from '../entities/pr.js';
import type { Issue } from '../entities/issue.js';

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
 * Reads the git host — the FOREIGN source of truth about PRs, builds, issues.
 *
 * Foreign state carries its askability apart from its answer, which is why
 * every operation returns a `PortResult`: a Bitbucket repo with a disabled
 * tracker is permanently `unaskable`, while an expired token is a `failed`
 * call that will succeed once somebody logs in.
 *
 * The issue operations read and never write. Plot's record of an issue is the
 * plan that references it; a copy of tracker state ages into a lie.
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
}
