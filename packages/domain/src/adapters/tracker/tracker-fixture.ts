import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type {
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
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
  /** Whether a status write fails outright. */
  statusWriteFails?: boolean;
  /** The limit readings `limit` reports. */
  limits?: readonly LimitReading[];
}

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
  return {
    config: (): TrackerConfig => ({
      scheme: fixture.scheme ?? 'fixture',
      baseUrl: fixture.baseUrl ?? '',
    }),

    issueList: async (limit): Promise<PortResult<readonly Issue[]>> =>
      answered(limit === undefined ? issues : issues.slice(0, limit)),

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

    limit: async (): Promise<PortResult<readonly LimitReading[]>> =>
      answered(fixture.limits ?? []),

    // ALWAYS NULL, and that is the fixture being honest rather than incomplete.
    // Every operation above answers, so there is never a call this could be
    // about.
    lastRefusal: (): string | null => null,
  };
};
