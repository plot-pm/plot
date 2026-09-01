import type { Issue } from '../../entities/issue.js';
import type { Pr } from '../../entities/pr.js';
import type { Host, HostBackend, MergedAnswer, PrLookup } from '../../ports/host.js';
import { answered, type PortResult } from '../../port-result.js';

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
  return {
    backend: async (): Promise<PortResult<HostBackend>> =>
      answered(fixture.backend ?? 'github'),

    prState: async (ref): Promise<PortResult<PrLookup>> =>
      answered(prs.find((pr) => String(pr.number) === String(ref)) ?? null),

    prMerged: async (branch): Promise<PortResult<MergedAnswer>> =>
      answered(merged.has(branch) ? 'merged' : 'not-merged'),

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
  };
};
