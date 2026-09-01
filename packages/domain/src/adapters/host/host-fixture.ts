import type { Issue } from '../../entities/issue.js';
import { correctForRefusal, type LimitReading } from '../../entities/limit.js';
import type { Pr } from '../../entities/pr.js';
import type {
  Host,
  HostBackend,
  LimitObservation,
  MergedAnswer,
  PrCreateRequest,
  PrLookup,
} from '../../ports/host.js';
import { answered, failed, type PortResult } from '../../port-result.js';

/** The host a fixture answers as. */
export interface HostFixture {
  /** Which backend the fixture claims to be. */
  backend?: HostBackend;
  /** The branches the host reports as merged. Everything else is `not-merged`. */
  merged?: readonly string[];
  /** The PRs `prList` reports, and `prState` looks up by number. */
  prs?: readonly Pr[];
  /** The issues `issueList` reports, and `issueView` looks up by id. */
  issues?: readonly Issue[];
  /**
   * The limit readings `limit` reports, before any correction.
   *
   * Empty by default, and that is an ANSWER: a fixture told nothing about
   * limits stands for a connector that meters nothing. It is not `free`, and a
   * caller reading it gets no reading rather than a reassuring number.
   */
  limits?: readonly LimitReading[];
  /**
   * Where every `prCreate` is recorded, in call order.
   *
   * A FIXTURE THAT ONLY ANSWERED COULD NOT PROVE IDEMPOTENCE. The whole claim
   * of the acting slice is that a second finding opens NOTHING, and the only
   * evidence for it is how many times the write was attempted — which a
   * read-only fixture discards. The caller supplies the array so it can read it
   * afterwards.
   */
  opened?: PrCreateRequest[];
  /**
   * Whether opening a PR fails.
   *
   * A host that refuses the write is a real case and a different one from a
   * host that opened nothing because nothing asked. Default is to succeed.
   */
  prCreateFails?: boolean;
}

/**
 * A `Host` that answers from values, reaching nothing.
 *
 * THE MOCK BOARD NEEDS ONE OR IT IS NOT A MOCK. `hostShell` spawns
 * `plot-host.sh`, so a composition root handing the shell adapter to
 * `mockEstate` would put a process on the path of a board whose whole promise
 * is that it serves fixtures — and it would be counted by the layering gate
 * that exists to stop exactly that.
 *
 * **A branch not listed as merged is `not-merged`, never `unknown`.** The
 * fixture KNOWS its estate: it was handed one. `unknown` is the answer a real
 * host gives when it could not be asked, and a fixture claiming it would let a
 * test assert against an uncertainty this adapter can never actually have.
 *
 * @param fixture - the estate to answer from.
 * @returns a `Host` backed by those values.
 */
export const hostFixture = (fixture: HostFixture = {}): Host => {
  const merged = new Set(fixture.merged ?? []);
  const prs = fixture.prs ?? [];
  const issues = fixture.issues ?? [];
  const opened = fixture.opened ?? [];
  // Mutable, because the correction rule is behaviour rather than a value and
  // the fixture must be able to show it. A fixture that always answered the
  // literal input could not stand in for an adapter that learns.
  let limits: readonly LimitReading[] = fixture.limits ?? [];
  return {
    backend: async (): Promise<PortResult<HostBackend>> =>
      answered(fixture.backend ?? 'github'),

    prState: async (ref): Promise<PortResult<PrLookup>> =>
      answered(prs.find((pr) => String(pr.number) === String(ref)) ?? null),

    prMerged: async (branch): Promise<PortResult<MergedAnswer>> =>
      answered(merged.has(branch) ? 'merged' : 'not-merged'),

    prCreate: async (request): Promise<PortResult<string>> => {
      opened.push(request);
      // RECORDED BEFORE IT REFUSES. A failed write was still an attempt, and a
      // test asserting that nothing asked twice must be able to see the second
      // ask even when the first one broke.
      if (fixture.prCreateFails === true) return failed();
      return answered(`https://example.invalid/pr/${opened.length}`);
    },

    prList: async (_state, limit): Promise<PortResult<readonly Pr[]>> =>
      answered(limit === undefined ? prs : prs.slice(0, limit)),

    issueList: async (limit): Promise<PortResult<readonly Issue[]>> =>
      answered(limit === undefined ? issues : issues.slice(0, limit)),

    issueView: async (id): Promise<PortResult<Issue>> => {
      const found = issues.find((issue) => String(issue.id) === String(id));
      return found
        ? answered(found)
        : answered({ ...(issues[0] ?? ({} as Issue)), id: String(id) });
    },

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => answered(limits),

    observe: (observed: LimitObservation): void => {
      limits = limits.map((reading) => correctForRefusal(reading, observed));
    },
  };
};
