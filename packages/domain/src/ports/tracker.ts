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
 * What a status write is told, and the whole of what Plot may say to a tracker.
 *
 * THE SUBJECT IS A PLOT ARTIFACT, not a tracker one. Plot names the PR it
 * moved and the status it moved it to; which ticket, card or item that
 * corresponds to is the tracker's own mapping and the connector's to resolve.
 * Widening this to a body, a label or an assignee is the mirror this port
 * exists to refuse.
 */
export interface StatusWrite {
  /** The pull request the status is about, as its address. */
  prUrl: string;
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
 * Reads a tracker, and writes one fact back to it.
 *
 * A TRACKER IS NOT A GIT HOST. `Tracker` is declared independently of the git
 * host, so a repository whose code lives with one vendor and whose tickets live
 * with another has two foreign services and needs two interfaces. Asking the
 * git host about issues made a capability belonging to a different service
 * report *not my department* — the `unaskable` this port keeps for the case it
 * really names, a repository that declared no tracker at all.
 *
 * EVERY IMPLEMENTATION IS A CONNECTOR. A tracker is a remote service with an
 * account, credentials, a rate limit and a transport choice, which is what
 * separates a connector from an adapter reaching the local machine. Each
 * implementation therefore owns its OWN budget: one vendor's token, limits and
 * refusals say nothing about another's, and a single implementation branching
 * on scheme would have to hold two of each.
 *
 * THE WRITE IS ONE FACT AND STAYS ONE. Plot writes a status to the tracker it
 * was told about and writes nothing else — no ticket, no comment, no label, no
 * transition it was not asked for. A plan referencing an issue remains Plot's
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
   * @returns the issues; `unaskable` where the repository declared no tracker.
   */
  issueList(limit?: number): Promise<PortResult<readonly Issue[]>>;

  /**
   * Reads one issue, with its body.
   *
   * Fetched per click rather than per refresh: the body is what a person reads
   * to decide, so its cadence is a human's.
   *
   * @param id - the issue's identifier, opaque — equality only, because one
   *   tracker yields a number and another a key and only one of them is a
   *   number by accident of the vendor.
   * @returns the issue; `unaskable` where the repository declared no tracker.
   */
  issueView(id: string): Promise<PortResult<Issue>>;

  /**
   * Records one status against a pull request, and nothing else.
   *
   * THE ONE WRITE ON THIS PORT. It is allowed where creating and closing
   * tickets is not, for the reason the read-only rule was written to protect:
   * a mirrored ticket ages into a lie, while a status Plot itself just caused
   * is the fact Plot is the authority on. It is also idempotent by nature — the
   * same status written twice is the same status.
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
}
