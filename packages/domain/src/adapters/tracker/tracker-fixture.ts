import type { Issue } from '../../entities/issue.js';
import { ISSUE_PAGE_ROWS } from '../../entities/issue-index.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type {
  ClosedIssues,
  IssueOpen,
  IssueOpenOutcome,
  IssueRead,
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
  TrackerSpender,
} from '../../ports/tracker.js';

/** The tracker a fixture answers as. */
export interface TrackerFixture {
  /** Which scheme the fixture claims to be; `''` reads as no tracker declared. */
  scheme?: string;
  /** The fixture's address; `''` where it has none. */
  baseUrl?: string;
  /** The issues `issueList` reports, and `issueView` looks up by id. */
  issues?: readonly Issue[];
  /**
   * The issues `issueListInbox` reports; `undefined` answers `unaskable`,
   * matching a connector with no person-scoped read apart from the open one.
   */
  inbox?: readonly Issue[];
  /**
   * Where every `statusWrite` is recorded, in call order.
   *
   * A FIXTURE THAT ONLY ANSWERED COULD NOT PROVE A WRITE REACHED THE TRACKER.
   * The whole claim this port settles is that a declared tracker is written to
   * and an undeclared one is not, and the only evidence for either is how many
   * times the write was attempted — which a read-only fixture discards. The
   * caller supplies the array so it can read it afterwards.
   */
  written?: StatusWrite[];
  /**
   * What a status write answers with.
   *
   * `written` by default. `no-target` stands for a tracker that was reached and
   * holds nowhere to put the status, which is a real answer and a different one
   * from a write that broke.
   */
  outcome?: StatusOutcome;
  /** Where every `issueOpen` is recorded, in call order, before it can refuse. */
  opened?: IssueOpen[];
  /** Whether an issue-open write fails outright. */
  issueOpenFails?: boolean;
  /** Whether a status write fails outright. */
  statusWriteFails?: boolean;
  /** The limit readings `limit` reports. */
  limits?: readonly LimitReading[];
  /** What `spender` reports; connector `fixture` and a null account by default. */
  spender?: TrackerSpender;
}

/** The requests a read of `rows` rows spends: one per started page, at least 1. */
const pagesOf = (rows: number): number => Math.max(1, Math.ceil(rows / ISSUE_PAGE_ROWS));

/**
 * A `Tracker` that answers from values, reaching nothing.
 *
 * The connectors beside it spawn `plot-host.sh`, so a test asserting what
 * reaches a tracker needs one that reaches nothing — otherwise the assertion is
 * about whichever tracker the machine running the test happens to be
 * configured for.
 *
 * IT IS NOT `trackerNone`. That one stands for a repository with no
 * tracker and answers `unaskable` everywhere; this one stands for a tracker
 * that is there, and answers.
 *
 * @param fixture - the tracker to answer from.
 * @returns a `Tracker` backed by those values.
 */
export const trackerFixture = (fixture: TrackerFixture = {}): Tracker => {
  const issues = fixture.issues ?? [];
  const written = fixture.written ?? [];
  const opened = fixture.opened ?? [];
  return {
    config: (): TrackerConfig => ({
      scheme: fixture.scheme ?? 'fixture',
      baseUrl: fixture.baseUrl ?? '',
    }),

    issueList: async (limit): Promise<PortResult<readonly Issue[]>> =>
      answered(limit === undefined ? issues : issues.slice(0, limit)),

    // Every fixture issue with a `closedAt` at or after `since`, newest first.
    issueListClosed: async (since, limit): Promise<PortResult<ClosedIssues>> => {
      const closed = issues
        .filter((issue) => issue.closedAt !== null && issue.closedAt >= since)
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
      return answered({ issues: closed.slice(0, limit), complete: closed.length < limit, pages: pagesOf(Math.min(closed.length, limit)) });
    },

    // Every fixture issue with no `closedAt`, in fixture order.
    issueListOpen: async (limit): Promise<PortResult<IssueRead>> => {
      const open = issues.filter((issue) => issue.closedAt === null);
      return answered({ issues: open.slice(0, limit), complete: open.length < limit, pages: pagesOf(Math.min(open.length, limit)) });
    },

    issueListInbox: async (limit): Promise<PortResult<IssueRead>> => {
      if (fixture.inbox === undefined) return unaskable('this fixture has no inbox configured');
      const inbox = fixture.inbox;
      return answered({ issues: inbox.slice(0, limit), complete: inbox.length < limit, pages: pagesOf(Math.min(inbox.length, limit)) });
    },

    issueView: async (id): Promise<PortResult<Issue>> => {
      const found = issues.find((issue) => issue.id === id);
      return found
        ? answered(found)
        : answered({ ...(issues[0] ?? ({} as Issue)), id, body: '' });
    },

    statusWrite: async (write): Promise<PortResult<StatusOutcome>> => {
      // RECORDED BEFORE IT REFUSES. A failed write was still an attempt, and a
      // test asserting that an undeclared tracker was never written to must be
      // able to see an attempt that broke.
      written.push(write);
      if (fixture.statusWriteFails === true) return failed();
      return answered(fixture.outcome ?? 'written');
    },

    issueOpen: async (write): Promise<PortResult<IssueOpenOutcome>> => {
      // RECORDED BEFORE IT REFUSES, like `statusWrite`.
      opened.push(write);
      if (fixture.issueOpenFails === true) return failed();
      return answered<IssueOpenOutcome>({ outcome: 'opened', id: String(opened.length) });
    },

    limit: async (): Promise<PortResult<readonly LimitReading[]>> =>
      answered(fixture.limits ?? []),

    // ALWAYS NULL, and that is the fixture being honest rather than incomplete.
    // Every operation above answers, so there is never a call this could be
    // about.
    lastRefusal: (): string | null => null,

    spender: async (): Promise<PortResult<TrackerSpender>> =>
      answered(fixture.spender ?? { connector: 'fixture', account: null }),
  };
};
