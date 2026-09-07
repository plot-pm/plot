import type { AgentState } from '../entities/agent.js';
import { STATE_SOURCE, type StateSource } from '../transitions/agent.js';
import { taskState, type TaskReadings } from './task.js';

/**
 * Whether the pid recorded at launch still names the worker that was launched.
 *
 * THREE VALUES, BECAUSE TWO CANNOT SAY WHAT THE SHELL SAYS. A pid answers
 * `kill -0` or it does not, and a pid that answers may still be the wrong
 * process: the kernel assigns pids from a circular pool, and a manifest that sat
 * for days may name a number an unrelated process now holds. `stale` is that
 * third reading, and it is not `dead` — a stale pid means a live process was
 * found and rejected, which is why {@link agentState} answers `ended` for it
 * rather than reading an exit file that belongs to nobody.
 *
 * - `live` — the pid answers, and either its start time is at or after the
 *   manifest's or nothing recorded a start time to check against.
 * - `stale` — the pid answers and the process began before the manifest was
 *   stamped, so the operating system reused the number.
 * - `dead` — the pid does not answer.
 */
export type PidLiveness = 'live' | 'stale' | 'dead';

/**
 * What a recorded exit says, as read rather than as parsed.
 *
 * `null` IS THE RECORD'S ABSENCE and `''` IS AN UNREADABLE RECORD, and they
 * reach the same answer by different routes — a worker killed outright left no
 * file, one whose wrapper died mid-write left a file saying nothing. Both are
 * `ended`, because guessing success from a record nobody can read is the same
 * invention as guessing failure from one.
 *
 * A non-numeric string is carried verbatim rather than coerced. The shell
 * resolved a real disagreement on it — the scan answered `ended` and
 * `plot-dispatch.sh` answered `failed (exit abc)` — in favour of `ended`, on
 * the principle that an unreadable record licenses no verdict.
 */
export type ExitReading = string | null;

/**
 * What was measured of one desk, before anything decided a word.
 *
 * READINGS AS VALUES, NO I/O. The pid, its liveness, the exit code, the desk's
 * dirtiness, a `PLOT-BLOCKED` marker, whether a worktree exists on this
 * machine. The shell keeps reading them; this rule decides from the same
 * values, which is what lets a corpus test hand both sides one set of readings
 * and compare two words.
 */
export interface AgentStateReadings {
  /**
   * Whether this machine holds a worktree for the agent at all.
   *
   * ANSWERED BEFORE ANY OTHER READING and answered outside the desk: it is a
   * question about the worktree LIST rather than about anything inside a
   * worktree. `plot_worker_state` never produces `elsewhere` for this reason —
   * its callers iterate worktrees they found, so the question is settled before
   * the function is reached.
   */
  worktreeHere: boolean;
  /**
   * Whether a usable pid was recorded, from the manifest or the worktree file.
   *
   * `false` covers every route to *no pid to check*: no manifest and no pid
   * file, an empty file, or a value that is not a pid. Pid `0` is in that last
   * group — `kill -0 0` signals the whole process group and succeeds, so a
   * zero read as live would report `running` forever.
   */
  pidRecorded: boolean;
  /** What the recorded pid answers, when one was recorded. */
  liveness: PidLiveness;
  /** The recorded exit code as read, `''` when unreadable, `null` when absent. */
  exit: ExitReading;
  /** What the desk holds, for the three states the desk decides. */
  task: TaskReadings;
}

/**
 * Whether an exit reading names a number a caller can act on.
 *
 * An empty or non-numeric record is not a code. This is the one place that
 * decides it, so the two arms below cannot drift on what `abc` means.
 */
const exitIsNumeric = (exit: ExitReading): exit is string =>
  exit !== null && exit !== '' && /^\d+$/.test(exit);

/**
 * Which of the eight an agent is in, from readings alone.
 *
 * THE ORDER IS THE SHELL'S, and every step of it is a measurement rather than
 * a preference:
 *
 * 1. **No worktree here is `elsewhere`**, and it outranks everything because
 *    nothing below it can be read without a desk to read.
 * 2. **No pid is `none`.** An absent record is its own answer; guessing
 *    `finished` would be the same mistake in the other direction.
 * 3. **A live pid is `running`**, and a `stale` one is `ended` — a reused
 *    number means the worker is dead and no exit file can be trusted either.
 * 4. **Exit 0 is refined by the desk**, and it is the ONLY arm refined. Every
 *    worker exits 0 — the one that opened its PR, the one that would not claim
 *    a test run it had not seen, and the one that stopped to ask a question —
 *    so `0` says only *the process ended tidily*, which is the blur
 *    {@link taskState} exists to split.
 * 5. **An unreadable or absent exit is `ended`.**
 * 6. **A non-zero exit is `failed`, unless a PR outranks it.** The exit code
 *    answers *how did the process end?*; a PR is a claim about the WORK, and
 *    the two come apart exactly when a worker is killed after delivering.
 *    Measured 2026-08-24 on `bug/the-agents-tab-filters-on-membership`: a
 *    worker SIGTERMed with its work pushed and PR #393 open rendered
 *    `worker crashed - someone is on it` indefinitely, because nothing about
 *    the branch can change a recorded exit code. With no PR fact this stays
 *    `failed` — calling a genuine crash `finished` is the guess this must
 *    never make.
 *
 * @param readings - what was measured of the desk and its process.
 * @returns which of the eight states the agent is in.
 */
export const agentState = (readings: AgentStateReadings): AgentState => {
  if (!readings.worktreeHere) return 'elsewhere';
  if (!readings.pidRecorded) return 'none';
  if (readings.liveness === 'live') return 'running';
  if (readings.liveness === 'stale') return 'ended';
  if (!exitIsNumeric(readings.exit)) return 'ended';
  if (readings.exit === '0') return taskState(readings.task);
  return readings.task.hasPr ? taskState(readings.task) : 'failed';
};

/**
 * Which component's reading produced a state, as the deriver reached it.
 *
 * **`STATE_SOURCE` IS THE SPECIFICATION AND THIS IS THE CHECK.**
 * `transitions/agent.ts` maps every state to whether the process or the desk
 * answers it, transcribed from `DESIGN-agent.md:366`. A deriver that
 * contradicts it is wrong by the domain's own record — so this reads the map
 * rather than restating it, and the two cannot disagree because there is only
 * one table.
 *
 * @param state - the state {@link agentState} answered.
 * @returns which component read it.
 */
export const agentStateSource = (state: AgentState): StateSource => STATE_SOURCE[state];
