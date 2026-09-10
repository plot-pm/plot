import type { BuildRun, ShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import type { PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';
import type { ShellContext } from '../scripts.js';
import { buildReads } from './build-shell.js';

/** The system word `plot-host.sh` knows this connector by, and tags its limit with. */
const SYSTEM = 'jenkins';

/**
 * Reads the CI system whose builds live on a Jenkins instance.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's instance,
 * this vendor's token and this vendor's window, and never sees another CI
 * connector's — the property that makes it a file rather than a `case` in
 * `build-resolve.ts`.
 *
 * IT SHELLS TO `plot-host.sh`, which stays the ONE place that talks to a host
 * CLI. `jen` is not invoked here: the script carries the colour-to-`checks`
 * mapping, the instance refusal and the exit-code contract this layer reads.
 *
 * IT NEEDS AN INSTANCE AND SAYS SO. `plot-host.sh` exits 3 without the
 * `Jenkins instance` key, naming three repairs, and this connector reports
 * that refusal through `lastRefusal()` rather than as an empty answer — a
 * repository whose instance is unset has not been asked, which is not the same
 * as a branch that has never built.
 *
 * `runForSha` IS `unaskable` HERE, AND THAT IS THE TRANSPORT'S LIMIT RATHER
 * THAN A GAP LEFT OPEN. `jenkins_build_map` answers `{color, checks, job}` per
 * BRANCH and carries no commit, so nothing in this transport can match a sha.
 * Measured 2026-09-10 against the live instance: a build entry from
 * `jen build list --json` holds `id`, `status`, timings and stages, and a
 * case-insensitive search of the whole payload for `sha|commit|revision|scm`
 * matches nothing. The answer exists in Jenkins — at
 * `actions[].BuildData.lastBuiltRevision.SHA1` over its REST API — and this
 * transport does not reach it.
 *
 * FALLING BACK TO THE BRANCH'S CURRENT STATE IS THE ONE ANSWER THAT COSTS A
 * MERGE, so the script refuses instead. `runForSha` exists because a run for a
 * superseded commit reads identically to a run for the current one.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `BuildPort` backed by this vendor's connector.
 */
export const buildJenkins = (context: ShellContext): BuildPort => {
  const reads = buildReads({ context, system: SYSTEM }, { PLOT_CI: SYSTEM });

  return {
    system: (): BuildSystem => SYSTEM,

    runs: (branch, limit): Promise<PortResult<readonly BuildRun[]>> => reads.runs(branch, limit),

    runForSha: (branch, sha, limit): Promise<PortResult<ShaRun | null>> =>
      reads.runForSha(branch, sha, limit),

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),
  };
};
