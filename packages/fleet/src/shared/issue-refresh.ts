import {
  foldChangedIssueRows,
  ISSUE_FULL_READ_MS,
  ISSUE_FULL_READ_PASSES,
  ISSUE_INDEX_CLOSED_DAYS,
  ISSUE_INDEX_OPEN_LIMIT,
  ISSUE_INDEX_VERSION,
  ISSUE_PAGE_ROWS,
  ISSUE_REFRESH_MS,
  issueIntervalMs,
  issueSource,
  issueWriteThrough,
  type InboxAnswer,
  type Issue,
  type IssueIndex,
  type IssueIndexClosed,
  type IssueIndexRow,
  type IssueSource,
  type PortResult,
} from '@plot-pm/domain';
import { TRACKER_LISTERS, trackerOfSource, type ShellContext } from '@plot-pm/domain/adapters';
import type { IssueIndexStore } from '@plot-pm/domain/ports/issue-index';
import type { IssueWriteSpool } from '@plot-pm/domain/ports/issue-write-spool';
import type { ClosedIssues, IssueRead, TrackerSpender } from '@plot-pm/domain/ports/tracker';

import { hostReaction, prGateOpen, waitOf, type IssueGateReading } from './pr-refresh.js';

/** What the issue gate keeps from one pass to the next. */
export interface IssueState {
  /** Epoch ms the next pass is due. 0 so the first pass runs at once. */
  issueNextAt: number;
  /** Whether `issueNextAt` is a backoff a refusal named, compared with no slack. */
  issueNextIsBackoff: boolean;
  /** The last pass's failure sentence, the source's absence reason, or null — never a read's `unsupported` answer, which is a standing fact rather than a failure. */
  issueError: string | null;
  /**
   * Host requests this issue pass has spent since the tick last read and
   * zeroed it. Never reset at the top of a pass; only the reader zeroes it.
   */
  calls: number;
}

/** An issue state as a fresh process holds it. */
export const freshIssueState = (): IssueState => ({
  issueNextAt: 0,
  issueNextIsBackoff: false,
  issueError: null,
  calls: 0,
});

/** The states whose pass or drain is writing the index now; the other waits for the next beat. */
const writing = new WeakSet<IssueState>();

/**
 * Whether a pass or a drain is writing the index for `state` now.
 *
 * @param state - the cadence carried between passes.
 * @returns true while one is.
 */
export const issueIndexBusy = (state: IssueState): boolean => writing.has(state);

/** The PR pass's own backoff, as the issue pass reads it. */
export interface PrBackoffReading {
  /** The PR pass's connector, or null before its first pass. */
  connector: string | null;
  /** The PR pass's account, or null where unread. */
  account: string | null;
  /** Epoch ms the PR pass's backoff ends, or null where it holds none. */
  until: number | null;
}

/** What one issue pass reaches. */
export interface IssueWorld {
  /** Where the scripts and the repository are; the pass builds its tracker from it. */
  context: ShellContext;
  /** The repository's declared `Tracker` config value, verbatim. */
  declaredTracker: string;
  /** The repository's git host backend word. */
  gitHost: string;
  /** The issue index; the pass is its one writer. */
  issueStore: IssueIndexStore;
  /** The writes Plot made to the tracker, waiting for the next drain; absent where none are taken. */
  issueWrites?: IssueWriteSpool;
  /** Reads the PR pass's backoff. The issue pass never writes the PR state. */
  prBackoff: () => PrBackoffReading;
  /** The clock in epoch ms; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * One issue as the issue index holds it: the tracker's own fields, each
 * present only where the tracker gave it.
 *
 * @param issue - the issue the tracker answered.
 * @returns the index row.
 */
export const issueIndexRowOf = (issue: Issue): IssueIndexRow => ({
  number: issue.id,
  title: issue.title,
  url: issue.url,
  ...(issue.createdAt === null ? {} : { createdAt: issue.createdAt }),
  ...(issue.updatedAt === undefined ? {} : { updatedAt: issue.updatedAt }),
  ...(issue.status === '' ? {} : { status: issue.status }),
  ...(issue.statusCategory === '' ? {} : { statusCategory: issue.statusCategory }),
  ...(issue.closedAt === null ? {} : { closedAt: issue.closedAt }),
  ...(issue.assignees.length === 0 ? {} : { assignees: issue.assignees }),
  ...(issue.type === undefined ? {} : { type: issue.type }),
});

const DAY_MS = 86_400_000;

/**
 * The earliest closing time a closed read asks for.
 *
 * @param startedAt - epoch ms the pass started.
 * @returns the time {@link ISSUE_INDEX_CLOSED_DAYS} days before, ISO-8601.
 */
export const closedSince = (startedAt: number): string =>
  new Date(startedAt - ISSUE_INDEX_CLOSED_DAYS * DAY_MS).toISOString();

/** What one closed read leaves: the closed set, its error, its backoff and its spend. */
export interface ClosedOutcome {
  /** The closed set to hold. */
  closed: IssueIndexClosed;
  /** The read's failure or unsupported sentence, or null where it answered. */
  error: string | null;
  /** Milliseconds a rate limit in the refusal asks to wait, or null where there is none. */
  wait: number | null;
  /** The requests the read spent: its pages where it answered, 0 where unsupported, 1 where it failed. */
  spent: number;
}

/**
 * Folds one closed read into the closed set.
 *
 * - An answered read replaces the set whole: `since`, `at`, its rows and
 *   `complete`.
 * - A failed or unsupported read keeps `kept`'s `since`, `at`, `rows` and
 *   `complete` and records `failedAt` and `reason`. Where nothing was kept,
 *   `since` is the time asked for and `at` is absent, because no closed read
 *   has answered.
 *
 * @param read - the closed read's answer.
 * @param kept - the closed set the previous pass left for the same source and connector.
 * @param since - the earliest closing time the read asked for, ISO-8601.
 * @param at - when the pass started, ISO-8601.
 * @param refusal - the tracker's `lastRefusal()` after the read.
 * @param finishedAt - epoch ms the read finished, the start of a named wait.
 * @returns the closed set, the error, the wait and the spend.
 */
export const closedOutcomeOf = (
  read: PortResult<ClosedIssues>,
  kept: IssueIndexClosed | undefined,
  since: string,
  at: string,
  refusal: string | null,
  finishedAt: number,
): ClosedOutcome => {
  if (read.ok) {
    return {
      closed: { since, at, answer: 'answered', rows: read.value.issues.map(issueIndexRowOf), complete: read.value.complete },
      error: null,
      wait: null,
      spent: read.value.pages,
    };
  }
  const unsupported = read.why === 'unaskable';
  const error = refusal ?? (unsupported ? read.reason : undefined) ?? (unsupported
    ? 'the tracker lists no closed issues'
    : 'the closed issue read failed and said nothing');
  return {
    closed: {
      since: kept?.since ?? since,
      ...(kept?.at === undefined ? {} : { at: kept.at }),
      answer: unsupported ? 'unsupported' : 'failed',
      failedAt: at,
      reason: error,
      ...(kept?.rows === undefined ? {} : { rows: kept.rows }),
      ...(kept?.complete === undefined ? {} : { complete: kept.complete }),
    },
    error,
    wait: unsupported ? null : waitOf(hostReaction(error, null, finishedAt)),
    spent: unsupported ? 0 : 1,
  };
};

/** What one inbox read leaves: its rows, their age, its error, its backoff and its spend. */
export interface InboxOutcome {
  /** The inbox rows to hold; absent where no inbox read happened. */
  inbox: IssueIndexRow[] | undefined;
  /** When `inbox` was last answered, ISO-8601; absent where it never has been. */
  inboxAt: string | undefined;
  /** How the read that left `inbox` ended; absent where an earlier file did not record it. */
  answer: InboxAnswer | undefined;
  /** The read's failure sentence, or null where it answered, was unsupported or did not happen. */
  error: string | null;
  /** Milliseconds a rate limit in the refusal asks to wait, or null where there is none. */
  wait: number | null;
  /** The requests the read spent: its pages where it answered, 1 where it failed, 0 where unsupported or skipped. */
  spent: number;
}

/**
 * The outcome of an inbox read that did not happen this pass: the kept rows,
 * their age and their answer, no error, no wait, no spend.
 *
 * Used both where the pass skips the inbox read because the closed read
 * failed — `kept` and `keptAt` carry over untouched, the same as any other
 * field this pass did not ask about — and, with both undefined, for an
 * `unaskable` read inside {@link inboxOutcomeOf}, which DROPS THE KEPT INBOX
 * AND ITS AGE instead of keeping them: the read no longer applies (no
 * `Ticket prefixes` declared, or a tracker other than Jira), so rows from
 * when it did would be answering a question nobody is asking any more.
 *
 * @param kept - the inbox rows to carry over; undefined to drop them.
 * @param keptAt - their age to carry over; undefined to drop it.
 * @param keptAnswer - how the read that left `kept` ended: `not-read` where no
 *   earlier pass of the same source and connector exists, undefined where an
 *   earlier file did not record it.
 */
export const inboxSkipped = (
  kept?: IssueIndexRow[] | undefined,
  keptAt?: string | undefined,
  keptAnswer?: InboxAnswer | undefined,
): InboxOutcome => ({
  inbox: kept,
  inboxAt: keptAt,
  answer: keptAnswer,
  error: null,
  wait: null,
  spent: 0,
});

/**
 * Folds one inbox read into the index's `inbox` and `inboxAt` fields.
 *
 * `inbox` is absent, never `[]`, where the read did not happen — which is
 * D30's whole point: an UNSUPPORTED read (no `Ticket prefixes` declared, or a
 * tracker with no person-scoped read apart from the open one) costs nothing,
 * the same way {@link closedOutcomeOf} costs nothing for an unsupported closed
 * read, and drops any rows and age kept from a since-retracted declaration
 * (see {@link inboxSkipped}). A read that FAILED spends 1 request, keeps
 * `kept` and its `keptAt` unmoved — so a reader derives the rows' staleness by
 * comparing `keptAt` against now — and its refusal feeds the pass's backoff
 * through `wait`, as a failed closed read's does.
 *
 * @param read - the inbox read's answer.
 * @param kept - the inbox rows the previous pass left for the same source and connector.
 * @param keptAt - when `kept` was last answered, ISO-8601; absent where it never has been.
 * @param at - when this pass started, ISO-8601.
 * @param refusal - the tracker's `lastRefusal()` right after the inbox read.
 * @param finishedAt - epoch ms the read finished, the start of a named wait.
 * @returns the rows to hold, their age, the error, the wait and the requests spent.
 */
export const inboxOutcomeOf = (
  read: PortResult<IssueRead>,
  kept: IssueIndexRow[] | undefined,
  keptAt: string | undefined,
  at: string,
  refusal: string | null,
  finishedAt: number,
): InboxOutcome => {
  if (read.ok) {
    return {
      inbox: read.value.issues.map(issueIndexRowOf),
      inboxAt: at,
      answer: 'answered',
      error: null,
      wait: null,
      spent: read.value.pages,
    };
  }
  if (read.why === 'unaskable') return { ...inboxSkipped(), answer: 'unaskable' };
  const error = refusal ?? 'the inbox read failed and said nothing';
  return {
    inbox: kept,
    inboxAt: keptAt,
    answer: 'failed',
    error,
    wait: waitOf(hostReaction(error, null, finishedAt)),
    spent: 1,
  };
};

/**
 * Whether a pass must run the full open+closed+inbox read rather than ask
 * {@link Tracker.issueListChanged} alone.
 *
 * TRUE IS THE SAFE DEFAULT. An absent `fullReadAt` or `passesSinceFull` reads
 * as due — a file written before the incremental read existed, or a `held`
 * this pass cannot reuse (another source or connector, or anything but an
 * answered read), has no floor to compare against and must read whole.
 *
 * @param held - the index the previous pass left, or null.
 * @param sameHeld - whether `held` is of this pass's own source and connector.
 * @param startedAt - epoch ms this pass started.
 * @returns whether this pass must read whole.
 */
export const dueForFullRead = (
  held: IssueIndex | null,
  sameHeld: boolean,
  startedAt: number,
): boolean => {
  if (held === null || !sameHeld || held.answer !== 'answered') return true;
  if (held.fullReadAt === undefined || held.passesSinceFull === undefined) return true;
  if (held.passesSinceFull >= ISSUE_FULL_READ_PASSES) return true;
  return startedAt - new Date(held.fullReadAt).getTime() >= ISSUE_FULL_READ_MS;
};

/** Whether a backoff is live and on the spender's own connector and account. */
const holdsFor = (
  until: number | null,
  connector: string | null,
  account: string | null,
  spender: TrackerSpender,
  now: number,
): boolean =>
  until !== null && until > now && connector === spender.connector && account === spender.account;

/**
 * The sentence an `unaskable` read keeps where the tracker left no refusal.
 *
 * @param source - who was asked.
 * @param gitHost - the repository's git host backend word.
 * @returns the reason the open issues are not listed.
 */
const unaskableReason = (source: Exclude<IssueSource, { ask: 'nobody' }>, gitHost: string): string =>
  source.ask === 'git-host'
    ? `the git host \`${gitHost}\` lists no issues`
    : `the declared tracker \`${source.scheme}\` cannot be asked for its issues`;

/**
 * One issue pass: reads the open issues of the source `issueSource` names and
 * writes the issue index.
 *
 * - A `nobody` source asks nothing and writes no file; `issueError` holds the
 *   source's reason.
 * - The pass asks nothing while a live backoff is held on its own connector and
 *   account: the PR pass's, or the one the index recorded. It sets
 *   `issueNextAt` to the backoff's end, as a hard floor.
 * - WHERE {@link dueForFullRead} ANSWERS FALSE, the pass asks
 *   {@link Tracker.issueListChanged} first, since `held.at`. A complete
 *   answer is folded into `held.rows` and `held.closed.rows` through
 *   {@link foldChangedIssueRows} and replaces the full open+closed+inbox read
 *   below: `requests` is the changed read's own pages, `fullReadAt` carries
 *   over unchanged and `passesSinceFull` increments by one. An INCOMPLETE
 *   answer (it stopped at {@link ISSUE_INDEX_OPEN_LIMIT}) and an UNASKABLE one
 *   (a tracker or git host with no changed-since read) fall through to the
 *   full read, which adds the changed read's pages to its `requests`; an
 *   unaskable read spends 0 and sets no error. A FAILED changed read keeps
 *   `rows`, `closed`, `at` and `fullReadAt`, increments `passesSinceFull` by
 *   one, and records `failedAt`/`reason`, feeding `backoffUntil` through
 *   {@link hostReaction} the same way a failed closed read does.
 * - An answered open read writes `nextAt` one {@link issueIntervalMs} after the
 *   pass started, `backoffUntil: null`, and at most
 *   {@link ISSUE_INDEX_OPEN_LIMIT} rows read page by page, with the read's own
 *   `complete`. `requests` is the open read's pages plus the closed read's
 *   spend (its pages where it answered, 1 where it failed, 0 where it is
 *   unsupported) plus the inbox read's spend (its pages where it answered, 1
 *   where it failed, 0 where it is unsupported or skipped); see
 *   {@link closedOutcomeOf} and {@link inboxOutcomeOf}. A page is
 *   {@link ISSUE_PAGE_ROWS} rows. This is the FULL READ: it also writes
 *   `fullReadAt` to the pass's own `at` and resets `passesSinceFull` to 0, the
 *   floor {@link dueForFullRead} compares against. A full read that FAILS
 *   outright (the open read itself did not answer) keeps the previous
 *   `fullReadAt` and `passesSinceFull` unmoved, same as `rows` and `complete`.
 * - An answered open read is followed by a closed read of the last
 *   {@link ISSUE_INDEX_CLOSED_DAYS} days, written under `closed` with its own
 *   `answer`, `at`, `complete` and `rows`, and an inbox read written under
 *   `inbox` and `inboxAt` — the reader's own open tickets and when they were
 *   last answered, where the tracker has a person-scoped read apart from the
 *   open one (D23). Each pass replaces all three sets whole. A closed read
 *   that fails or is unsupported keeps the previous `closed` `since`, `at`,
 *   rows and `complete`. An inbox read that FAILS keeps the previous `inbox`
 *   rows and `inboxAt` unmoved, so a reader derives their staleness by
 *   comparing `inboxAt` against now; one that is UNSUPPORTED — no
 *   `Ticket prefixes` declared, or a tracker other than Jira — drops both
 *   instead, because the read no longer applies and the previous rows would
 *   answer a question nobody is asking any more; see {@link inboxSkipped}.
 *   Either leaves the open rows as the open read set them. Neither is asked
 *   where the open read did not answer. The closed read's refusal is read
 *   right after the closed read, before the inbox read can reset it, and a
 *   closed read that failed (not unsupported) skips the inbox read, keeping
 *   its previous `inbox` and `inboxAt` as D23 did before this field existed.
 *   A refused inbox read feeds the same backoff; where both refuse,
 *   `backoffUntil` is the later wait. `inboxAnswer` records how the read that
 *   left `inbox` ended — `answered`, `unaskable` or `failed` — and a skipped
 *   read carries the previous one, or `not-read` where no earlier pass of the
 *   same source and connector exists.
 * - A refused read writes `requests`, `nextAt`, `failedAt` and `reason`, keeps
 *   the previous `rows`, `complete` and `at` of the same source and connector,
 *   and writes `backoffUntil` where {@link hostReaction} reads a rate limit in
 *   the refusal, and keeps the previous `closed` and `inbox` of the same
 *   source and connector. The `reason` of an unaskable read is the sentence
 *   the port carried, or a sentence naming the source where it carried none.
 *
 * @param world - what the pass reaches.
 * @param state - the cadence carried between passes.
 */
export const refreshIssueIndex = async (world: IssueWorld, state: IssueState): Promise<void> => {
  const clock = world.now ?? Date.now;
  const startedAt = clock();
  const source = issueSource({ declared: world.declaredTracker, gitHost: world.gitHost, listers: TRACKER_LISTERS });
  if (source.ask === 'nobody') {
    state.issueError = source.reason;
    state.issueNextAt = startedAt + ISSUE_REFRESH_MS;
    state.issueNextIsBackoff = false;
    return;
  }
  const tracker = trackerOfSource(source, world.declaredTracker, world.gitHost, world.context);
  const spent = await tracker.spender();
  const spender: TrackerSpender = spent.ok ? spent.value : { connector: world.gitHost, account: null };

  const previous = await world.issueStore.read();
  const held = previous.ok ? previous.value : null;
  const pr = world.prBackoff();
  const holds = [
    holdsFor(pr.until, pr.connector, pr.account, spender, startedAt) ? pr.until : null,
    held !== null && holdsFor(held.backoffUntil, held.connector, held.account ?? null, spender, startedAt)
      ? held.backoffUntil
      : null,
  ].filter((until): until is number => until !== null);
  if (holds.length > 0) {
    state.issueNextAt = Math.max(...holds);
    state.issueNextIsBackoff = true;
    return;
  }

  const sameHeld = held !== null && held.source === source.ask && held.connector === spender.connector;
  const keptClosed: Pick<IssueIndex, 'closed'> = sameHeld && held.closed !== undefined ? { closed: held.closed } : {};
  const keptInbox = sameHeld ? held.inbox : undefined;
  const keptInboxAt = sameHeld ? held.inboxAt : undefined;
  const keptInboxAnswer: InboxAnswer | undefined = sameHeld ? held.inboxAnswer : 'not-read';

  let changedSpent = 0;
  if (!dueForFullRead(held, sameHeld, startedAt) && held !== null && held.at !== undefined) {
    const changedRead = await tracker.issueListChanged(held.at, ISSUE_INDEX_OPEN_LIMIT);
    if (changedRead.ok && changedRead.value.complete) {
      const at = new Date(startedAt).toISOString();
      const fold = foldChangedIssueRows(
        held.rows ?? [],
        held.closed?.rows ?? [],
        held.closed?.since ?? closedSince(startedAt),
        changedRead.value.issues.map(issueIndexRowOf),
      );
      const requests = changedRead.value.pages;
      state.calls += requests;
      const nextAt = startedAt + issueIntervalMs(requests);
      state.issueError = null;
      state.issueNextAt = nextAt;
      state.issueNextIsBackoff = false;
      await world.issueStore.write({
        v: ISSUE_INDEX_VERSION,
        source: source.ask,
        connector: spender.connector,
        ...(spender.account === null ? {} : { account: spender.account }),
        requests,
        nextAt,
        backoffUntil: null,
        at,
        answer: 'answered',
        rows: fold.rows,
        ...(held.complete === undefined ? {} : { complete: held.complete }),
        fullReadAt: held.fullReadAt,
        passesSinceFull: (held.passesSinceFull ?? 0) + 1,
        ...(held.closed === undefined ? {} : { closed: { ...held.closed, rows: fold.closedRows } }),
        ...(keptInbox === undefined ? {} : { inbox: keptInbox }),
        ...(keptInboxAt === undefined ? {} : { inboxAt: keptInboxAt }),
        ...(keptInboxAnswer === undefined ? {} : { inboxAnswer: keptInboxAnswer }),
      });
      return;
    }
    if (changedRead.ok) {
      changedSpent = changedRead.value.pages;
    } else if (changedRead.why !== 'unaskable') {
      const finishedAt = clock();
      const refusal = tracker.lastRefusal();
      const reason = refusal ?? 'the changed issue read failed and said nothing';
      const wait = waitOf(hostReaction(reason, null, finishedAt));
      const backoffUntil = wait === null ? null : finishedAt + wait;
      const requests = 1;
      state.calls += requests;
      const nextAt = startedAt + issueIntervalMs(requests);
      state.issueError = reason;
      state.issueNextAt = backoffUntil ?? nextAt;
      state.issueNextIsBackoff = backoffUntil !== null;
      await world.issueStore.write({
        v: ISSUE_INDEX_VERSION,
        source: source.ask,
        connector: spender.connector,
        ...(spender.account === null ? {} : { account: spender.account }),
        requests,
        nextAt: backoffUntil ?? nextAt,
        backoffUntil,
        at: held.at,
        answer: 'answered',
        failedAt: new Date(startedAt).toISOString(),
        reason,
        rows: held.rows,
        ...(held.complete === undefined ? {} : { complete: held.complete }),
        fullReadAt: held.fullReadAt,
        passesSinceFull: (held.passesSinceFull ?? 0) + 1,
        ...keptClosed,
        ...(keptInbox === undefined ? {} : { inbox: keptInbox }),
        ...(keptInboxAt === undefined ? {} : { inboxAt: keptInboxAt }),
        ...(keptInboxAnswer === undefined ? {} : { inboxAnswer: keptInboxAnswer }),
      });
      return;
    }
  }

  const result = await tracker.issueListOpen(ISSUE_INDEX_OPEN_LIMIT);

  if (result.ok) {
    const since = closedSince(startedAt);
    const closedRead = await tracker.issueListClosed(since, ISSUE_INDEX_OPEN_LIMIT);
    const closedRefusal = tracker.lastRefusal();
    const closedFinishedAt = clock();
    const at = new Date(startedAt).toISOString();
    const outcome = closedOutcomeOf(closedRead, keptClosed.closed, since, at, closedRefusal, closedFinishedAt);
    const closedRefused = !closedRead.ok && closedRead.why !== 'unaskable';
    let inboxOutcome = inboxSkipped(keptInbox, keptInboxAt, keptInboxAnswer);
    let finishedAt = closedFinishedAt;
    if (!closedRefused) {
      const inboxRead = await tracker.issueListInbox(ISSUE_INDEX_OPEN_LIMIT);
      finishedAt = clock();
      inboxOutcome = inboxOutcomeOf(inboxRead, keptInbox, keptInboxAt, at, tracker.lastRefusal(), finishedAt);
    }
    const requests = changedSpent + result.value.pages + outcome.spent + inboxOutcome.spent;
    state.calls += requests;
    const nextAt = startedAt + issueIntervalMs(requests);
    const ends = [
      outcome.wait === null ? null : closedFinishedAt + outcome.wait,
      inboxOutcome.wait === null ? null : finishedAt + inboxOutcome.wait,
    ].filter((until): until is number => until !== null);
    const backoffUntil = ends.length === 0 ? null : Math.max(...ends);
    state.issueError = (outcome.closed.answer === 'failed' ? outcome.error : null) ?? inboxOutcome.error;
    state.issueNextAt = backoffUntil ?? nextAt;
    state.issueNextIsBackoff = backoffUntil !== null;
    await world.issueStore.write({
      v: ISSUE_INDEX_VERSION,
      source: source.ask,
      connector: spender.connector,
      ...(spender.account === null ? {} : { account: spender.account }),
      requests,
      nextAt: backoffUntil ?? nextAt,
      backoffUntil,
      at,
      answer: 'answered',
      rows: result.value.issues.map(issueIndexRowOf),
      complete: result.value.complete,
      fullReadAt: at,
      passesSinceFull: 0,
      closed: outcome.closed,
      ...(inboxOutcome.inbox === undefined ? {} : { inbox: inboxOutcome.inbox }),
      ...(inboxOutcome.inboxAt === undefined ? {} : { inboxAt: inboxOutcome.inboxAt }),
      ...(inboxOutcome.answer === undefined ? {} : { inboxAnswer: inboxOutcome.answer }),
    });
    return;
  }

  const requests = changedSpent + 1;
  state.calls += requests;
  const nextAt = startedAt + issueIntervalMs(requests);
  const base: Pick<IssueIndex, 'v' | 'source' | 'connector' | 'account' | 'requests' | 'nextAt'> = {
    v: ISSUE_INDEX_VERSION,
    source: source.ask,
    connector: spender.connector,
    ...(spender.account === null ? {} : { account: spender.account }),
    requests,
    nextAt,
  };
  const finishedAt = clock();
  const answer: IssueIndex['answer'] = result.why === 'unaskable' ? 'unsupported' : 'failed';
  const refusal = tracker.lastRefusal();
  const stated = result.why === 'unaskable' ? result.reason : undefined;
  const reason = refusal ?? stated ?? (answer === 'unsupported'
    ? unaskableReason(source, world.gitHost)
    : 'the issue read failed and said nothing');
  const wait = answer === 'failed' ? waitOf(hostReaction(reason, null, finishedAt)) : null;
  const backoffUntil = wait === null ? null : finishedAt + wait;
  state.issueError = answer === 'failed' ? reason : null;
  state.issueNextAt = backoffUntil ?? nextAt;
  state.issueNextIsBackoff = backoffUntil !== null;

  const failedAt = new Date(startedAt).toISOString();
  await world.issueStore.write({
    ...base,
    backoffUntil,
    ...(sameHeld && held.at !== undefined ? { at: held.at } : {}),
    answer,
    failedAt,
    reason,
    ...(sameHeld && held.rows !== undefined ? { rows: held.rows } : {}),
    ...(sameHeld && held.complete !== undefined ? { complete: held.complete } : {}),
    ...(sameHeld && held.fullReadAt !== undefined ? { fullReadAt: held.fullReadAt } : {}),
    ...(sameHeld && held.passesSinceFull !== undefined ? { passesSinceFull: held.passesSinceFull } : {}),
    ...keptClosed,
    ...(keptInbox === undefined ? {} : { inbox: keptInbox }),
    ...(keptInboxAt === undefined ? {} : { inboxAt: keptInboxAt }),
    ...(keptInboxAnswer === undefined ? {} : { inboxAnswer: keptInboxAnswer }),
  });
};

/**
 * Whether the issue gate's next pass is due.
 *
 * The PR gate's own comparison: an ordinary `issueNextAt` opens within the
 * PR pass's tick slack, and a backoff opens only at or after `issueNextAt`.
 *
 * @param issueNextAt - epoch ms the next pass is due.
 * @param hard - whether `issueNextAt` is a backoff.
 * @param now - the clock in epoch ms; defaults to `Date.now`.
 * @returns whether a pass may run now.
 */
export const issueGateOpen = (issueNextAt: number, hard: boolean, now: () => number = Date.now): boolean =>
  prGateOpen(issueNextAt, hard, now());

/**
 * Builds the issue pass the fleet's clock runs: one tracker read behind its
 * own cadence gate, written to the issue index.
 *
 * @param world - what the pass reaches.
 * @param state - the cadence carried between passes.
 * @param warn - receives a one-line reason when a pass throws.
 * @returns the function to hand to `startFleetClock` as `issues`.
 */
export const fleetIssues = (
  world: IssueWorld,
  state: IssueState,
  warn: (line: string) => void,
): (() => Promise<void>) => async () => {
  if (!issueGateOpen(state.issueNextAt, state.issueNextIsBackoff, world.now ?? Date.now)) return;
  if (writing.has(state)) return;
  writing.add(state);
  try {
    await refreshIssueIndex(world, state);
  } catch (e) {
    warn(`plot-fleetd: issue read failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    writing.delete(state);
  }
};

/**
 * Folds the writes in the spool into the issue index.
 *
 * The write-through: the spool holds the rows Plot's own successful
 * `issueOpen` and `statusWrite` calls changed, and this is the one place they
 * reach `issues.json`, through the one writer. It asks the tracker nothing.
 * Where the index is missing, no write names its connector and account, or
 * the store cannot be read, the spool is still emptied: the next full read
 * answers every row.
 *
 * @param world - what the pass reaches; the spool and the store.
 * @returns the number of writes taken from the spool.
 */
export const drainIssueWrites = async (world: IssueWorld): Promise<number> => {
  if (world.issueWrites === undefined) return 0;
  const taken = await world.issueWrites.drain();
  if (!taken.ok || taken.value.length === 0) return 0;
  const previous = await world.issueStore.read();
  const next = issueWriteThrough(previous.ok ? previous.value : null, taken.value);
  if (next !== null) await world.issueStore.write(next);
  return taken.value.length;
};

/**
 * Builds the beat that drains the spool of tracker writes.
 *
 * It rides every base beat, so a row reaches the index within one beat of the
 * write. It waits while an issue pass writes the index, so the pass's whole-file
 * write cannot drop a folded row; the spool keeps the writes for the next beat.
 *
 * @param world - what the pass reaches.
 * @param state - the cadence carried between passes.
 * @param warn - receives a one-line reason when a drain throws.
 * @returns the function to hand to `startFleetClock` as `issueWrites`.
 */
export const fleetIssueWrites = (
  world: IssueWorld,
  state: IssueState,
  warn: (line: string) => void,
): (() => Promise<void>) => async () => {
  if (world.issueWrites === undefined || writing.has(state)) return;
  writing.add(state);
  try {
    await drainIssueWrites(world);
  } catch (e) {
    warn(`plot-fleetd: issue write-through failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    writing.delete(state);
  }
};

/**
 * Builds the PR pass's reader of the issue gate's cadence fields.
 *
 * @param store - the issue index.
 * @returns a reader answering the index's `connector`, `account` (null where
 *   absent), `requests`, `nextAt` and `backoffUntil`; null where the index is
 *   missing, unreadable or of another version.
 */
export const issueGateOf = (store: IssueIndexStore) => async (): Promise<IssueGateReading | null> => {
  const read = await store.read();
  if (!read.ok || read.value === null) return null;
  const held = read.value;
  return {
    connector: held.connector,
    account: held.account ?? null,
    requests: held.requests,
    nextAt: held.nextAt,
    backoffUntil: held.backoffUntil,
  };
};
