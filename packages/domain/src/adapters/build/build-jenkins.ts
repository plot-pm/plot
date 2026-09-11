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
 * `runForSha` ASKS JENKINS' REST API, and the transport is the whole story.
 * `jen` answers build history and never a commit — measured 2026-09-10, a
 * build entry carries `id`, `status`, timings and stages, and a search of the
 * whole payload for `sha|commit|revision|scm` matches nothing. Jenkins' own
 * REST API answers it at `actions[].lastBuiltRevision.SHA1`, and
 * `plot-host.sh` reaches that since 2026-09-11.
 *
 * THE CREDENTIAL IS NOT THE KEYCLOAK BEARER. Jenkins takes basic auth with an
 * API token, which `jen` stores in the login keychain; the bearer from `jen
 * auth token` gets an HTML login redirect. A machine with no keychain entry
 * answers `unaskable`, which is *this connector cannot be asked* rather than
 * *this branch has never built*.
 *
 * IT INHERITS THE GITHUB ARM'S FALLBACK RULE rather than inventing one: the
 * asked-for sha if a build carries it, else the newest build, with `sha`
 * saying which. A caller that could not tell those apart would be back to the
 * branch-scoped guessing this operation exists to end.
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
