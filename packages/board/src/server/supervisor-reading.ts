import type { Scripts, SupervisorRun } from '@plot-pm/domain';
import { scriptsFor, type BuildBoardOptions } from './board.js';

/**
 * THE SUPERVISOR READING, TAKEN ON THE REFRESH'S CLOCK.
 *
 * One local query per pulse — no host call, no network. It sits beside
 * `machine-reading.ts` and for the same reason: the rule that decides `up` /
 * `down` / `unknown` is pure and synchronous, asking is neither, so the asking
 * happens here and the answer travels as a value.
 *
 * ## The one source, and why nothing else may be read
 *
 * `plot-fleetctl.sh --status` already answers this and its exit code is the
 * contract: **0 when the supervisor is loaded, 1 when it is not.** A second
 * implementation reading a pidfile, `launchctl`, or a process name would drift
 * toward *looks fine* — the direction nobody notices, which is the whole
 * defect. A `pkill`-style match on process names is specifically refused:
 * `plot-boardctl.sh`'s header records a `pkill -f` that killed an operator's
 * board on 2026-09-04, and the same guess reads just as wrong as it kills.
 *
 * ## No new port
 *
 * `Scripts.awaited` is already *the ONE place `plot-*.sh` is invoked*, and it
 * is the operation that hands back both streams beside the exit code — which is
 * exactly what this reading needs. Putting *is a named service loaded* on
 * `machine.ts` would widen a port whose stated subject is *how loaded is this
 * box*, and a port of its own would be a second way to invoke a Plot script.
 * It is an ADAPTER path and not a connector's: `launchctl`/`systemctl` is the
 * local machine, with no account, no credentials and no rate limit.
 *
 * ## What it costs
 *
 * Measured 2026-09-07 on this machine: 0.46 s in a checkout with no fleet
 * worktrees, 1.42 s in one with 27 — `--status` walks every desk and asks
 * `plot_worker_state` about each. That is above the *few tens of milliseconds*
 * the plan hoped for, which is why the call is bounded and taken on `refresh`,
 * off the request path, exactly where the machine measurement already is. It
 * runs once per refresh and no `/api/board` request waits on it.
 */

/**
 * How long the reading may take before it is abandoned.
 *
 * 5 s against a measured 1.42 s on the largest fleet here — roughly three and a
 * half times the worst reading, and one refresh cadence. A call that exceeds it
 * answers `unknown` rather than `down`, which is the rule this whole module is
 * organised around.
 */
export const SUPERVISOR_TIMEOUT_MS = 5_000;

/** The script that answers, and the only one that may. */
const SCRIPT = 'plot-fleetctl.sh';

/**
 * The line `--status` prints last, and the proof that it printed anything.
 *
 * A killed process leaves partial stdout, so the presence of this prefix is
 * what separates a script that finished from one stopped at a bounded wait.
 * `execFile` reports a `SIGTERM` timeout as exit code 1 — the script's own word
 * for *not loaded* — so the code alone cannot tell the two apart.
 *
 * A SECOND ORIGIN, MEASURED 2026-09-07: run outside a git repository, `--status`
 * prints `plot-fleetctl: not a git repository` and exits 1, refusing before the
 * fleet walk and printing no summary. Reading the code alone would report an
 * unsupervised fleet from every directory that is not a repository.
 */
const SUMMARY_PREFIX = 'summary:';

/**
 * Asks whether a supervisor is loaded, and reports what the run left behind.
 *
 * THE RUN AND NOT THE VERDICT. The verdict also needs the agent count, which is
 * re-derived on every render while this is asked once per refresh — handing
 * back a verdict here would pin the count to whenever the script was last
 * asked, and a warning is precisely the combination of the state with a current
 * count. `supervisorVerdict` is applied on the render clock instead.
 *
 * A THROW IS THE SAME FACT AS A FAILED CALL: nothing was read. It is caught
 * rather than propagated because this runs inside the refresh's success path,
 * and a probe that could not fork must not take the whole refresh with it.
 *
 * @param opts - where the repository and the scripts are.
 * @param scripts - the runner to ask through; this repository's by default.
 * @returns what the run left behind, or the unasked reading where it failed.
 */
export async function readSupervisor(
  opts: BuildBoardOptions,
  scripts: Scripts = scriptsFor(opts),
): Promise<SupervisorRun> {
  try {
    const run = await scripts.awaited(SCRIPT, ['--status'], {
      timeoutMs: SUPERVISOR_TIMEOUT_MS,
    });
    return {
      asked: true,
      exitCode: run.code,
      summarised: run.stdout.includes(SUMMARY_PREFIX),
    };
  } catch {
    return { asked: false, exitCode: null, summarised: false };
  }
}
