import type { BuildRun, ShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';

/** The CI system a fixture answers as. */
export interface BuildFixture {
  /** Which system the fixture claims to be; `''` reads as no CI declared. */
  system?: string;
  /**
   * The run history `runs` reports, by branch.
   *
   * A branch with no entry answers `[]` — the system was asked and holds no
   * runs for it. It is never a refusal: a fixture knows its own estate and has
   * nothing to be throttled by.
   */
  runs?: Readonly<Record<string, readonly BuildRun[]>>;
  /**
   * The sha-pinned runs `runForSha` reports, by branch then sha.
   *
   * A branch with no entry answers null — the branch has no runs at all, which
   * is what a caller polling a fresh push sees. A branch WITH an entry and no
   * match for the sha answers its newest run, which is the fallback the real
   * connector makes and the case a caller must be able to test.
   */
  shaRuns?: Readonly<Record<string, readonly ShaRun[]>>;
  /**
   * The limit readings `limit` reports.
   *
   * Empty by default, and that is an ANSWER: a fixture told nothing about
   * limits stands for a connector that meters nothing.
   */
  limits?: readonly LimitReading[];
  /** Whether every read fails outright. */
  fails?: boolean;
}

/**
 * A `BuildPort` that answers from values, reaching nothing.
 *
 * The connectors beside it spawn `plot-host.sh`, so a test asserting what a
 * board renders from a run history needs one that reaches nothing — otherwise
 * the assertion is about whichever CI the machine running the test happens to
 * be configured for.
 *
 * IT IS NOT `buildNone`. That one stands for a repository with no CI and
 * answers `unaskable` everywhere; this one stands for a CI that is there, and
 * answers.
 *
 * @param fixture - the estate to answer from.
 * @returns a `BuildPort` backed by those values.
 */
export const buildFixture = (fixture: BuildFixture = {}): BuildPort => {
  const runs = fixture.runs ?? {};
  const shaRuns = fixture.shaRuns ?? {};
  const broken = fixture.fails === true;
  return {
    system: (): BuildSystem => fixture.system ?? 'fixture',

    runs: async (branch, limit): Promise<PortResult<readonly BuildRun[]>> => {
      if (broken) return failed();
      const history = runs[branch] ?? [];
      return answered(limit === undefined ? history : history.slice(0, limit));
    },

    runForSha: async (branch, sha): Promise<PortResult<ShaRun | null>> => {
      if (broken) return failed();
      const history = shaRuns[branch] ?? [];
      // THE SHA ASKED ABOUT IF THERE IS ONE, ELSE THE NEWEST — the fallback the
      // real connector makes, reproduced here because a caller's rule about a
      // superseded run is the thing a test needs to exercise.
      return answered(history.find((run) => run.sha === sha) ?? history[0] ?? null);
    },

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => {
      if (broken) return failed();
      return answered(fixture.limits ?? []);
    },

    // NULL WHERE NOTHING REFUSED, and the fixture's own sentence where a read
    // was told to break. A fixture that reported no refusal after failing would
    // let a test assert a silence the real connector never produces.
    lastRefusal: (): string | null => (broken ? 'build fixture: told to fail' : null),
  };
};
