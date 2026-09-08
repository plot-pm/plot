import type { BuildRun, ShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import type { PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';
import type { ShellContext } from '../scripts.js';
import { buildReads } from './build-shell.js';

/** The system word `plot-host.sh` knows this connector by, and tags its limit with. */
const SYSTEM = 'github-actions';

/**
 * Reads the CI system whose runs live with GitHub Actions.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's account,
 * this vendor's token and this vendor's window, and it never sees another CI
 * connector's — which is why it is a file rather than a `case`.
 *
 * IT SHELLS TO `plot-host.sh`, which stays the ONE place that talks to a host
 * CLI. `gh` is not invoked here: the script already carries the exit-code
 * contract this layer reads, and a connector calling the CLI directly would be
 * a second implementation of the mapping the script exists to hold.
 *
 * THE GATE IT INHERITED IS FIXED, AND ONE HALF OF IT REMAINS BY DESIGN.
 * `plot-host.sh`'s `runs` and `run-for-sha` arms gated on the GIT HOST rather
 * than the CI system until 2026-09-08, so on a repository whose code is not on
 * GitHub they printed nothing and this connector answered an empty list. They
 * now dispatch on the `CI` key this connector passes in `PLOT_CI`.
 *
 * A GITHUB REMOTE IS STILL REQUIRED, and that is a second condition rather
 * than the old one surviving: `gh run list` reads the runs of the repository
 * its remote names, so `CI: github-actions` on a Bitbucket remote names runs
 * nothing can reach. The script exits 4 there and this connector answers
 * `unaskable` — which is the true word, where the empty list was not.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `BuildPort` backed by this vendor's connector.
 */
export const buildActions = (context: ShellContext): BuildPort => {
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
