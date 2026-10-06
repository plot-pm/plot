import type { WorkerActivity, WorkerState } from '../../entities/fleet.js';
import { answered, type PortResult } from '../../port-result.js';
import type { Processes, ProcessReading } from '../../ports/processes.js';
import { asLines, asText, runProcess, runScript, resultOf } from '../run-script.js';
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
 * `ps -o etime=` output → seconds, or null for anything it does not recognise.
 *
 * The four shapes `etime` emits, all measured on macOS 2026-08-19: `MM:SS`,
 * `HH:MM:SS`, `DD-HH:MM:SS`, and — for a dead pid — nothing at all. Linux adds
 * no fifth shape. Anything else, a localised `ps` or a future format, yields
 * null: an unparsed reading is an absent uptime and never a zero one.
 *
 * @param raw - what `ps` printed.
 * @returns the elapsed seconds, or null where the shape is unrecognised.
 */
export const parseEtime = (raw: string): number | null => {
  const text = raw.trim();
  if (!text) return null;
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, d, h, min, s] = m;
  const days = d ? Number(d) : 0;
  const hours = h ? Number(h) : 0;
  return days * 86_400 + hours * 3_600 + Number(min) * 60 + Number(s);
};

/** The leading number of a field the way `awk` reads it: `12abc` is 12, `abc` is 0. */
const leadingNumber = (text: string): number => {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)/.exec(text);
  return m ? Number(m[0]) : 0;
};

/**
 * `ps -o time=` output (`[[HH:]MM:]SS.ss`) → integer centiseconds.
 *
 * Parsed field by field from the right, as `plot_worker_cpu_centis` does, so a
 * process past an hour of CPU still totals correctly. The fraction is cut to
 * two digits and a missing one counts as zero.
 *
 * @param clock - one `time=` field.
 * @returns the CPU time in centiseconds.
 */
export const centisOf = (clock: string): number => {
  const parts = clock.split(':');
  let total = 0;
  let multiplier = 1;
  for (let at = parts.length - 1; at >= 0; at -= 1) {
    const part = parts[at] ?? '';
    if (at === parts.length - 1) {
      const [whole = '', fraction = ''] = part.split('.');
      total += leadingNumber(whole) * 100 + leadingNumber(`${fraction}00`.slice(0, 2));
    } else {
      total += leadingNumber(part) * 60 * 100 * multiplier;
      multiplier *= 60;
    }
  }
  return total;
};

/**
 * The CPU centiseconds of a pid and every process descended from it, from one
 * `ps -o pid=,ppid=,time= -ax` snapshot.
 *
 * @param table - the snapshot's text.
 * @param root - the subtree's root pid.
 * @returns the total, or null where the root is not in the snapshot.
 */
export const subtreeCentis = (table: string, root: string): number | null => {
  const parent = new Map<string, string>();
  const clock = new Map<string, string>();
  for (const line of table.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (m === null) continue;
    parent.set(m[1] as string, m[2] as string);
    clock.set(m[1] as string, (m[3] as string).trim());
  }
  if (!parent.has(root)) return null;
  const inSet = new Set<string>([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of parent) {
      if (!inSet.has(pid) && inSet.has(ppid)) {
        inSet.add(pid);
        grew = true;
      }
    }
  }
  let total = 0;
  for (const pid of inSet) {
    const c = clock.get(pid);
    if (c !== undefined) total += centisOf(c);
  }
  return total;
};

/** Milliseconds between the two CPU samples, as `plot_worker_activity` reads `PLOT_ACTIVITY_INTERVAL`. */
const sampleIntervalMs = (): number => {
  const seconds = Number(process.env.PLOT_ACTIVITY_INTERVAL ?? '0.4');
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 400;
};

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

    childrenOf: async (pid): Promise<PortResult<readonly number[]>> => {
      // MATCHES `_kill_tree`'s OWN READ (`plot-worker-loop.sh:2054`): `pgrep -P`
      // lists direct children, and a parent with none exits 1 having printed
      // nothing — an answer (no children), never a failure.
      const run = await runProcess('pgrep', ['-P', String(pid)], inRepo);
      if (run.code !== 0) return answered<readonly number[]>([]);
      return answered(
        asLines(run.stdout)
          .map((line) => Number(line))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
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

    uptimeSeconds: async (pid) => {
      // A pid at or below zero is refused before it reaches `ps`. `kill -0 0`
      // signals the caller's whole process group, and the equivalent trap has
      // been sprung in this repo before — so `0` answers null rather than being
      // asked about.
      if (!Number.isInteger(pid) || pid <= 0) return answered<number | null>(null);
      const run = await runProcess('ps', ['-o', 'etime=', '-p', String(pid)], inRepo);
      // A non-zero exit IS the reading: `ps` exits non-zero for a pid nobody is
      // running, and *nothing is running under this pid* is the answer the
      // panel renders as an absent uptime.
      return answered<number | null>(run.code === 0 ? parseEtime(run.stdout) : null);
    },
    // TWO SAMPLES OF THE WHOLE SUBTREE, matching `plot_worker_activity`: the
    // child is where the work is, and only the DELTA separates a worker in a
    // long build from one whose child died. A pid naming no process answers
    // `''` — nothing to measure is not an idle child.
    activity: async (pid): Promise<PortResult<WorkerActivity>> => {
      if (!Number.isInteger(pid) || pid <= 0) return answered<WorkerActivity>('');
      const sample = async (): Promise<number | null> => {
        const run = await runProcess('ps', ['-o', 'pid=,ppid=,time=', '-ax'], inRepo);
        return run.code === 0 ? subtreeCentis(run.stdout, String(pid)) : null;
      };
      const first = await sample();
      if (first === null) return answered<WorkerActivity>('');
      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs()));
      const second = await sample();
      if (second === null) return answered<WorkerActivity>('');
      return answered<WorkerActivity>(second > first ? 'working' : 'idle');
    },
  };
};
