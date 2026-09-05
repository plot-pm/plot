import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { Performer } from '../../ports/performer.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The script that owns desk creation, the manifest and the monitors. */
const DISPATCH = 'plot-dispatch.sh';

/**
 * How long one start may take before it is abandoned, in milliseconds.
 *
 * A start cuts a full checkout and spawns a detached wrapper, and the checkout
 * is what dominates: the fleet's desks are 4.9 GB across 21 trees on this
 * estate. Sixty seconds is generous for a `git worktree add` off a warm object
 * store and short enough that a supervisor tick — 3.5 s, on a 60 s interval —
 * is not held past its own cadence by one desk that will not cut.
 */
const START_TIMEOUT_MS = 60_000;

/**
 * Starts agents by shelling to `plot-dispatch.sh --start`, one desk per call.
 *
 * **THE PRODUCTION PERFORMER, AND IT IS A SECOND ONE.** `perform-fs.ts` lists
 * `worker-start` in `BEYOND_THE_FILESYSTEM` and skips it, so a sandbox running
 * that performer cannot start a real agent whatever a decision says. That is
 * correct and stays correct: the answer to *how does production start one* is
 * a different implementation, not a hole in the sandbox's.
 *
 * **IT DECIDES NOTHING.** How many agents to start is `fleetSize`'s, which
 * agent gets which slice is `matchQueue`'s, and where a desk goes arrived in the
 * write. This runs one command and reports what it did — the same division
 * `perform-fs.ts` holds on the other side of the port.
 *
 * **IT REACHES THE PROCESS TABLE THROUGH THE SCRIPT AND NOT PAST IT.** The
 * script owns desk creation, the session id, the manifest, the registry-path
 * gate and the three monitors, and `start_worker` is the single path to a
 * worker — which is what makes *every worker is born monitored* a gate rather
 * than a rule. A second spawner here would be a second path with none of that.
 *
 * @param context - the repository and where its helper scripts live.
 * @returns a performer that starts free agents.
 */
export const performerShell = (context: ShellContext): Performer => ({
  startFreeAgent: async (worktree): Promise<PortResult<number>> => {
    // ONE AGENT PER CALL, AND THE COUNT IS ALREADY DECIDED. `PLOT_START_ONE`
    // says exactly that to the script: start this one, do not re-derive a
    // fleet size. The script's own `--start N` subtracts the workers already
    // running, which is right for a person asking for a fleet of N and wrong
    // for a caller applying N writes one at a time — the second call would
    // subtract the agent the first just started. Measured 2026-09-05: a tick
    // that decided `started=3` produced one agent without this.
    //
    // THE DESK MAY BE EMPTY, and that is the domain declining to invent a path
    // rather than a missing value. The script then names one from its own
    // `Worktree root` convention, which is the one every other desk follows.
    const run = await runProcess(scriptPath(context, DISPATCH), ['--start', '1'], {
      cwd: context.repoRoot,
      env: { PLOT_START_ONE: '1', PLOT_START_DESK: worktree },
      timeoutMs: START_TIMEOUT_MS,
    });

    if (run.code !== 0) return failed<number>();

    // THE SUMMARY LINE IS THE ANSWER, not the exit code. The script exits 0
    // having started nothing when the machine bounded it, when the desk already
    // existed, or when no `Worker command` is configured — three different
    // facts that a caller reading only the code would read as three agents.
    const started = /(?:^|\n)summary: agents=(\d+)/.exec(run.stdout)?.[1];
    if (started === undefined) return failed<number>();

    // NO AGENT TOOLING IS `unaskable`, NOT A FAILURE. `Worker command: none`
    // means *asked, and this repo starts them by hand* — a deliberate answer
    // the supervisor must report as an absence rather than as an error it
    // should retry every sixty seconds.
    if (Number(started) === 0 && /worker=(?:unconfigured|declined)/.test(run.stdout)) {
      return unaskable<number>();
    }

    return answered(Number(started));
  },
});
