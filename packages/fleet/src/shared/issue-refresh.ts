import {
  ISSUE_INDEX_VERSION,
  ISSUE_LIST_LIMIT,
  ISSUE_REFRESH_MS,
  issueIntervalMs,
  issueSource,
  type Issue,
  type IssueIndex,
  type IssueIndexRow,
  type IssueSource,
} from '@plot-pm/domain';
import { TRACKER_LISTERS, trackerOfSource, type ShellContext } from '@plot-pm/domain/adapters';
import type { IssueIndexStore } from '@plot-pm/domain/ports/issue-index';
import type { TrackerSpender } from '@plot-pm/domain/ports/tracker';

import { hostReaction, prGateOpen, waitOf, type IssueGateReading } from './pr-refresh.js';

/** What the issue gate keeps from one pass to the next. */
export interface IssueState {
  /** Epoch ms the next pass is due. 0 so the first pass runs at once. */
  issueNextAt: number;
  /** Whether `issueNextAt` is a backoff a refusal named, compared with no slack. */
  issueNextIsBackoff: boolean;
  /** The last pass's failure or absence sentence, or null. */
  issueError: string | null;
}

/** An issue state as a fresh process holds it. */
export const freshIssueState = (): IssueState => ({
  issueNextAt: 0,
  issueNextIsBackoff: false,
  issueError: null,
});

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
  /** Reads the PR pass's backoff. The issue pass never writes the PR state. */
  prBackoff: () => PrBackoffReading;
  /** The clock in epoch ms; defaults to `Date.now`. */
  now?: () => number;
}

const rowOf = (issue: Issue): IssueIndexRow => ({
  number: issue.id,
  title: issue.title,
  url: issue.url,
  ...(issue.createdAt === null ? {} : { createdAt: issue.createdAt }),
  ...(issue.status === '' ? {} : { status: issue.status }),
  ...(issue.statusCategory === '' ? {} : { statusCategory: issue.statusCategory }),
});

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
 * - An answered read writes `requests: 1`, `nextAt` one {@link issueIntervalMs}
 *   after the pass started, `backoffUntil: null`, and at most
 *   {@link ISSUE_LIST_LIMIT} rows with `complete` true where fewer came back.
 * - A refused read writes `requests`, `nextAt`, `failedAt` and `reason`, keeps
 *   the previous `rows`, `complete` and `at` of the same source and connector,
 *   and writes `backoffUntil` where {@link hostReaction} reads a rate limit in
 *   the refusal.
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

  const requests = 1;
  const result = await tracker.issueList(ISSUE_LIST_LIMIT);
  const nextAt = startedAt + issueIntervalMs(requests);
  const base: Pick<IssueIndex, 'v' | 'source' | 'connector' | 'account' | 'requests' | 'nextAt'> = {
    v: ISSUE_INDEX_VERSION,
    source: source.ask,
    connector: spender.connector,
    ...(spender.account === null ? {} : { account: spender.account }),
    requests,
    nextAt,
  };

  if (result.ok) {
    state.issueError = null;
    state.issueNextAt = nextAt;
    state.issueNextIsBackoff = false;
    await world.issueStore.write({
      ...base,
      backoffUntil: null,
      at: new Date(startedAt).toISOString(),
      answer: 'answered',
      rows: result.value.map(rowOf),
      complete: result.value.length < ISSUE_LIST_LIMIT,
    });
    return;
  }

  const finishedAt = clock();
  const answer: IssueIndex['answer'] = result.why === 'unaskable' ? 'unsupported' : 'failed';
  const refusal = tracker.lastRefusal();
  const reason = refusal ?? (answer === 'unsupported'
    ? unaskableReason(source, world.gitHost)
    : 'the issue read failed and said nothing');
  const wait = answer === 'failed' ? waitOf(hostReaction(reason, null, finishedAt)) : null;
  const backoffUntil = wait === null ? null : finishedAt + wait;
  state.issueError = reason;
  state.issueNextAt = backoffUntil ?? nextAt;
  state.issueNextIsBackoff = backoffUntil !== null;

  const failedAt = new Date(startedAt).toISOString();
  const same = held !== null && held.source === source.ask && held.connector === spender.connector;
  await world.issueStore.write({
    ...base,
    backoffUntil,
    at: same ? held.at : failedAt,
    answer,
    failedAt,
    reason,
    ...(same && held.rows !== undefined ? { rows: held.rows } : {}),
    ...(same && held.complete !== undefined ? { complete: held.complete } : {}),
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
  try {
    await refreshIssueIndex(world, state);
  } catch (e) {
    warn(`plot-fleetd: issue read failed: ${e instanceof Error ? e.message : String(e)}`);
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
