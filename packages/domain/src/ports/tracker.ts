import type { Issue } from '../entities/issue.js';
import type { LimitReading } from '../entities/limit.js';
import type { PortResult } from '../port-result.js';

/**
 * Which tracker answers — the scheme a repository declared, in its own word.
 *
 * Unvalidated, like the git host's own backend word. The domain holds no list of
 * tracker vendors, so a tracker it has never heard of reaches the connector
 * that might drive it rather than being refused by a type.
 *
 * `''` is a repository that declared none, and it is a real value rather than
 * an absence: a tracker nobody configured is a fact worth answering with, not
 * a question to route somewhere.
 */
export type TrackerScheme = string;

/**
 * What a tracker was told about itself, and where it lives.
 *
 * The address is never composed. A scheme that needs one and was given none is
 * a configuration the connector refuses rather than guesses at, because a
 * guessed base URL answers 404 and a 404 reads as an empty inbox.
 */
export interface TrackerConfig {
  /** The declared scheme; `''` where the repository declared no tracker. */
  scheme: TrackerScheme;
  /** The tracker's address, verbatim; `''` where none was given. */
  baseUrl: string;
}

/**
 * Whose budget a tracker's reads spend.
 *
 * The key the machine's budget record files a connector's calls under, so a
 * caller can tell whether two readers spend one budget. Two readers spend one
 * budget only where both fields are equal.
 */
export interface TrackerSpender {
  /** The connector's own name, as its limit readings and budget lines are tagged. */
  connector: string;
  /** The account the budget record keys this connector's lines by; null where it could not be read. */
  account: string | null;
}

/**
 * What a status write is told, and the whole of what Plot may say to a tracker.
 *
 * THE SUBJECT IS A PLOT ARTIFACT, not a tracker one. Plot names the PR it
 * moved and the status it moved it to; which ticket, card or item that
 * corresponds to is the tracker's own mapping and the connector's to resolve.
 * Widening this to a body, a label or an assignee is the mirror this port
 * exists to refuse; `IssueOpen` is the one other write, and it carries a body
 * and labels because it states a fact Plot itself produced.
 */
export interface StatusWrite {
  /** The pull request the status is about, as its address; `''` where there is none. */
  prUrl: string;
  /**
   * The issue the status is about, where the caller knows it — a plan's
   * `Issue:` line. A connector whose subject is an issue reads this before it
   * reads `prUrl`; one whose subject is a pull request answers `no-target`
   * where `prUrl` is empty.
   */
  issue?: string;
  /** The status to record, in the tracker's own vocabulary. */
  status: string;
}

/**
 * What came of a status write.
 *
 * `written` and `no-target` are BOTH answers, and keeping them apart is the
 * point. A tracker that holds no board for this repository is configured and
 * reachable and has nowhere to put a status; a tracker that was never declared
 * never reaches this type at all, because the port answers `unaskable` for it.
 *
 * A write that broke is a `PortResult` failure and is not a member here.
 */
export type StatusOutcome = 'written' | 'no-target';

/**
 * What an issue-open write is told: the whole of the second write Plot may make.
 */
export interface IssueOpen {
  /** The issue's title. */
  title: string;
  /** The issue's body, verbatim. */
  body: string;
  /** The labels to apply, verbatim; empty for none. */
  labels: readonly string[];
}

/**
 * What came of an issue-open write: the issue exists, and this is its identifier.
 *
 * The identifier is opaque, like `issueView`'s: a number on one tracker, a key on
 * another. A write that broke is a `PortResult` failure and is not a member here.
 */
export interface IssueOpenOutcome {
  outcome: 'opened';
  /** The new issue's identifier, as the tracker states it. */
  id: string;
}

/**
 * The issues a tracker closed in a window, and whether the read reached its end.
 */
export interface ClosedIssues {
  /** The closed issues, newest close first, without bodies. */
  issues: readonly Issue[];
  /** False where the read stopped at its limit, so more may exist. */
  complete: boolean;
}

/**
 * Reads a tracker, and writes one fact back to it.
 *
 * A TRACKER IS NOT A GIT HOST, BUT ONE IMPLEMENTATION READS THROUGH IT.
 * `Tracker` is declared independently of the git host, so a repository whose
 * code lives with one vendor and whose tickets live with another has two
 * foreign services and needs two interfaces — that case keeps its own
 * account, credentials and budget. But a repository that named NO tracker and
 * tracks issues as git-host issues has only one foreign service, and
 * `trackerGitHost` answers that case by reading through the git host
 * connector's own budget rather than opening a second one nothing would
 * charge against. `unaskable` is kept for the one case left — a repository
 * that declared no tracker and has no git host to fall back to.
 *
 * MOST IMPLEMENTATIONS ARE CONNECTORS; `trackerGitHost` IS NOT ONE OF ITS OWN.
 * A tracker reaching a vendor directly is a remote service with an account,
 * credentials, a rate limit and a transport choice, which is what separates a
 * connector from an adapter reaching the local machine, and that
 * implementation owns its OWN budget. `trackerGitHost` reaches no vendor of
 * its own — it is built from `trackerReads` over the git host's existing
 * connector, tagged with that connector's backend word, so its `limit()`
 * reports the `host` bucket and no second budget is ever opened.
 *
 * THE WRITES ARE TWO FACTS AND STAY TWO. Plot writes a status to the tracker
 * it was told about, and opens an issue for a claim it refuted. It writes
 * nothing else — no comment, no label on an existing issue, no transition it
 * was not asked for. A plan referencing an issue remains Plot's
 * record; the status is the one fact the tracker owns a copy of, because it is
 * the one a person reads in the tracker rather than in Plot.
 */
export interface Tracker {
  /**
   * Names the tracker this connector answers as.
   *
   * @returns the scheme and address it was configured with.
   */
  config(): TrackerConfig;

  /**
   * Lists the tracker's open issues, without their bodies.
   *
   * The body is omitted because this runs on a timer for every open issue, and
   * a body per issue per refresh buys nothing a caller needs to decide whether
   * an issue is worth a plan.
   *
   * @param limit - how many to ask for; the connector's own page when omitted.
   * @returns the issues; `unaskable` where the repository declared no tracker
   *   and has no git host to read issues from instead.
   */
  issueList(limit?: number): Promise<PortResult<readonly Issue[]>>;

  /**
   * Lists the issues the tracker closed at or after `since`, without bodies.
   *
   * Newest close first. A read that returns `limit` rows reports
   * `complete: false`, because a read that stopped has not told the caller
   * everything.
   *
   * @param since - the earliest closing time to include, ISO-8601.
   * @param limit - how many issues to read at most.
   * @returns the closed issues; `unaskable` with its reason where the tracker
   *   states no closing date (Bitbucket), a Jira tracker declares no
   *   `Ticket prefixes`, or no tracker can be asked.
   */
  issueListClosed(since: string, limit: number): Promise<PortResult<ClosedIssues>>;

  /**
   * Reads one issue, with its body.
   *
   * Fetched per click rather than per refresh: the body is what a person reads
   * to decide, so its cadence is a human's.
   *
   * @param id - the issue's identifier, opaque — equality only, because one
   *   tracker yields a number and another a key and only one of them is a
   *   number by accident of the vendor.
   * @returns the issue; `unaskable` where the repository declared no tracker
   *   and has no git host to read issues from instead.
   */
  issueView(id: string): Promise<PortResult<Issue>>;

  /**
   * Records one status against a pull request, and nothing else.
   *
   * THE FIRST OF TWO WRITES ON THIS PORT; {@link Tracker.issueOpen} is the
   * second. It is allowed where closing tickets is not, for the reason the
   * read-only rule was written to protect: a mirrored ticket ages into a lie,
   * while a status Plot itself just caused is the fact Plot is the authority
   * on. It is also idempotent by nature — the same status written twice is the
   * same status.
   *
   * A REPOSITORY WITH NO TRACKER ANSWERS `unaskable`, NEVER `written`. A silent
   * success here is the failure this operation exists to make impossible: it
   * would report a status reaching a tracker somebody configured while nothing
   * left the machine.
   *
   * @param write - the pull request and the status to record.
   * @returns `written` where the status reached the tracker, `no-target` where
   *   the tracker is reachable and holds nowhere to put it; `unaskable` where
   *   no tracker was declared.
   */
  statusWrite(write: StatusWrite): Promise<PortResult<StatusOutcome>>;

  /**
   * Opens one issue, and nothing else.
   *
   * THE SECOND WRITE ON THIS PORT, for a different reason than `statusWrite`:
   * the issue states a fact Plot itself produced (a claim the verify workflow
   * refuted), not a copy of tracker state. It is NOT idempotent — the same call
   * twice opens two issues — and the port does not look for a duplicate. The
   * caller records what it opened.
   *
   * A REPOSITORY WITH NO TRACKER ANSWERS `unaskable`, NEVER `opened`, for the
   * reason `statusWrite` does.
   *
   * `failed` DOES NOT PROVE THAT NO ISSUE EXISTS. Where the request may have
   * reached the tracker — the call ended at its time bound or by a signal, or
   * the tracker answered with no identifier — `lastRefusal` starts with
   * `the issue may exist: `. A refusal without that prefix means the tracker
   * refused the request or was not reached.
   *
   * @param write - the title, body and labels of the issue.
   * @returns `opened` with the new issue's identifier; `unaskable` where no
   *   tracker was declared or the declared one cannot open issues; `failed`
   *   otherwise, with the reason in `lastRefusal`.
   */
  issueOpen(write: IssueOpen): Promise<PortResult<IssueOpenOutcome>>;

  /**
   * What is this connector's limit, and how well does it know it?
   *
   * ITS OWN, and that is why the operation is here rather than borrowed from
   * the git host. Two trackers reached from one repository have two accounts,
   * two tokens and two windows; a caller reading one connector's headroom to
   * pace calls against the other spends a budget it never measured.
   *
   * An empty list is an answer — this connector meters nothing. It is not
   * `free`: a caller reads the basis, and there is no reading to read.
   *
   * @returns one reading per bucket; `unaskable` where the connector cannot be
   *   asked at all.
   */
  limit(): Promise<PortResult<readonly LimitReading[]>>;

  /**
   * Why the most recent call did not answer, or null where it did.
   *
   * The sentence `PortResult` cannot carry. A connector's refusal has a
   * DURATION in it, and the connector is the only place that sentence exists.
   *
   * Set by every operation on this port, so a caller reads it immediately after
   * the call it is about and never later. It is the SESSION's, held in the
   * connector and gone when the process ends.
   *
   * @returns the last refusal, verbatim, or null where the last call answered.
   */
  lastRefusal(): string | null;

  /**
   * Names the budget this tracker's reads spend.
   *
   * Read from `plot-host.sh spend-rate`, which reads the machine's budget
   * record and asks no service. A record that cannot be read answers the
   * connector with a null account.
   *
   * @returns the connector and account; `unaskable` where the repository
   *   declared no tracker and has no git host to read issues from instead.
   */
  spender(): Promise<PortResult<TrackerSpender>>;
}
