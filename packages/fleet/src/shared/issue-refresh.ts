import { issueIntervalMs, type Issue, type IssueIndex, type IssueIndexRow } from '@plot-pm/domain';
import { trackerForIssues, type ShellContext } from '@plot-pm/domain/adapters';
import type { IssueIndexStore } from '@plot-pm/domain/ports/issue-index';

/**
 * What the issue gate keeps from one pass to the next, and what a caller reads
 * back for the PR pass's subtraction (D28).
 *
 * The store IS this state, read and written whole: unlike the PR reader there
 * is no in-memory map to seed, because `cadenceRateOf` needs only the four
 * fields {@link IssueIndex} already carries.
 */
export interface IssueState {
  /** Epoch ms the next pass is due. 0 so the first pass runs at once. */
  issueNextAt: number;
  /** The last pass's failure sentence, or null. */
  issueError: string | null;
}

/** An issue state as a fresh process holds it. */
export const freshIssueState = (): IssueState => ({
  issueNextAt: 0,
  issueError: null,
});

/** What one issue pass reaches. */
export interface IssueWorld {
  /** Where the scripts and the repository are — builds the tracker per pass. */
  context: ShellContext;
  /** The repository's declared `Tracker` config value, verbatim. */
  declaredTracker: string;
  /** The repository's git host backend word. */
  gitHost: string;
  /** The issue index. The pass folds the tracker's answer into it. */
  store: IssueIndexStore;
  /**
   * Reads the PR pass's own backoff, so the issue pass never asks while a
   * shared connector and account is already waiting out a backoff the PR
   * pass learned about first.
   */
  prBackoff: () => { connector: string | null; account: string | null; until: number | null };
  /** The clock in epoch ms; defaults to `Date.now`. A test injects one. */
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

/**
 * One issue pass: reads the tracker's open issues and folds the answer into
 * the issue index.
 *
 * ASKS NOTHING WHILE THE PR PASS'S OWN BACKOFF IS ON THE SAME CONNECTOR AND
 * ACCOUNT. The two passes can share one connector's budget — `trackerGitHost`
 * reads through the git host's own — and a backoff either pass learns about
 * is a fact about that shared budget, not about which pass asked. Asking
 * anyway would spend into a wait the PR pass already measured.
 *
 * A FAILED PASS KEEPS THE PREVIOUS `rows` AND `at`; `requests` and `nextAt`
 * move regardless, because scheduling the next pass is owed whether or not
 * this one answered.
 *
 * @param world - what the pass reaches; the fleet is the index's only writer.
 * @param state - the cadence carried between passes.
 */
export const refreshIssueIndex = async (world: IssueWorld, state: IssueState): Promise<void> => {
  const clock = world.now ?? Date.now;
  const startedAt = clock();
  const tracker = trackerForIssues(world.declaredTracker, world.gitHost, world.context);
  const previous = await world.store.read();
  const held = previous.ok ? previous.value : null;

  const backoff = world.prBackoff();
  const connector = held?.connector ?? world.gitHost;
  const account = held?.account ?? null;
  if (
    backoff.until !== null &&
    backoff.until > startedAt &&
    backoff.connector === connector &&
    backoff.account === account
  ) {
    state.issueNextAt = backoff.until;
    return;
  }

  const requests = 1;
  const result = await tracker.issueList();
  const nextAt = startedAt + issueIntervalMs(requests);
  state.issueNextAt = nextAt;

  const base = {
    v: 1 as const,
    source: (world.declaredTracker.trim() === '' ? 'git-host' : 'tracker') as IssueIndex['source'],
    connector: world.gitHost,
    requests,
    nextAt,
  };

  if (result.ok) {
    state.issueError = null;
    const next: IssueIndex = {
      ...base,
      backoffUntil: null,
      at: new Date(startedAt).toISOString(),
      answer: 'answered',
      rows: result.value.map(rowOf),
      complete: true,
    };
    await world.store.write(next);
    return;
  }

  const answer: IssueIndex['answer'] = result.why === 'unaskable' ? 'unsupported' : 'failed';
  const reason = tracker.lastRefusal() ?? answer;
  state.issueError = reason;
  const failedAt = new Date(startedAt).toISOString();
  const next: IssueIndex = held === null
    ? {
        ...base,
        backoffUntil: null,
        at: failedAt,
        answer,
        failedAt,
        reason,
      }
    : {
        ...held,
        ...base,
        backoffUntil: held.backoffUntil,
        at: held.at,
        answer,
        failedAt,
        reason,
      };
  await world.store.write(next);
};

/**
 * Whether the issue gate's next pass is due.
 *
 * The same shape `prGateOpen` answers in: an ordinary pass opens exactly at
 * `issueNextAt`, with no slack of its own to keep the issue clock simple.
 *
 * @param issueNextAt - epoch ms the next pass is due.
 * @param now - epoch ms; defaults to `Date.now`.
 * @returns whether a pass may run now.
 */
export const issueGateOpen = (issueNextAt: number, now: () => number = Date.now): boolean =>
  now() >= issueNextAt;

/**
 * Builds the issue pass the fleet's clock runs: one tracker read behind its
 * own cadence gate, folded into the issue index.
 *
 * @param world - what the pass reaches; the fleet is the index's only writer.
 * @param state - the cadence carried between passes.
 * @param warn - receives a one-line reason when a pass throws.
 * @returns the function to hand to `startFleetClock` as `issues`.
 */
export const fleetIssues = (
  world: IssueWorld,
  state: IssueState,
  warn: (line: string) => void,
): (() => Promise<void>) => async () => {
  if (!issueGateOpen(state.issueNextAt, world.now ?? Date.now)) return;
  try {
    await refreshIssueIndex(world, state);
  } catch (e) {
    warn(`plot-fleetd: issue read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
