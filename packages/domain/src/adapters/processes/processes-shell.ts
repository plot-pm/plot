import type { WorkerActivity, WorkerState } from '../../entities/fleet.js';
import { answered, type PortResult } from '../../port-result.js';
import type { Processes, ProcessReading } from '../../ports/processes.js';
import { asText, runProcess, runScript, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

const WORKER_STATES: readonly string[] = [
  'running',
  'finished',
  'failed',
  'ended',
  'none',
  'elsewhere',
  'waiting',
  'stalled',
];

const ACTIVITIES: readonly string[] = ['working', 'idle', ''];

/**
 * Reads the tab-separated fields `plot_worker_state` prints.
 *
 * An unrecognised state throws rather than degrading, because every value the
 * function can print is enumerated: a word outside the set means the script
 * and this adapter have diverged, and reporting it as `none` would hide that
 * behind a plausible reading.
 *
 * @param stdout - the function's output: state, pid, exit code, activity.
 * @returns the reading.
 */
const readingOf = (stdout: string): ProcessReading => {
  const [state = '', pid = '', exitCode = '', activity = ''] = asText(stdout).split('\t');
  if (!WORKER_STATES.includes(state)) {
    throw new Error(`plot-worker-state: unrecognised state ${state}`);
  }
  return {
    state: state as WorkerState,
    pid,
    exitCode,
    activity: (ACTIVITIES.includes(activity) ? activity : '') as WorkerActivity,
  };
};

/**
 * Reads the process table through `plot-worker-state.sh`.
 *
 * That script is sourced rather than run, so this adapter sources it inside a
 * `bash -c` and calls the function — which is how one computation stays one
 * implementation. Reimplementing the eight states here is exactly the
 * duplication that had already drifted on the sixth state before the script
 * became their single home.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `Processes` backed by the shell function and the process table.
 */
export const processesShell = (context: ShellContext): Processes => {
  const workerState = scriptPath(context, 'plot-worker-state.sh');
  const inRepo = { cwd: context.repoRoot };

  return {
    isAlive: async (pid) => {
      const run = await runProcess('bash', ['-c', `kill -0 ${pid} 2>/dev/null`], inRepo);
      return answered(run.code === 0);
    },

    workerState: async (worktree, hasPr): Promise<PortResult<ProcessReading>> => {
      const run = await runProcess(
        'bash',
        [
          '-c',
          '. "$1" && plot_worker_state "$2" "$3"',
          'bash',
          workerState,
          worktree,
          hasPr ? 'pr' : '',
        ],
        inRepo,
      );
      return resultOf(run, readingOf);
    },

    startedAt: (pid) =>
      runScript(
        'bash',
        ['-c', `ps -o lstart= -p ${pid}`],
        (stdout) => {
          const started = Date.parse(asText(stdout));
          if (Number.isNaN(started)) throw new Error(`ps: unreadable start time for ${pid}`);
          return started;
        },
        inRepo,
      ),
  };
};
