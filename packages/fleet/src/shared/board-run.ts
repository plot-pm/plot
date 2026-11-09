/**
 * Starting one board role's agent through the `agentRun` port, and recording
 * how it ended where the route's status read-back finds it.
 *
 * Ten routes start a board role. Each one truncates its own log, then calls
 * {@link markBoardRun} before it answers, and {@link startBoardRun} after. A
 * run a route starts `detached` on the `command` runner outlives the board: its
 * launcher records the run's pid, and the code its classified exit reads as, in
 * the state file. Any other run
 * stays in the board's process group, so a board stop or restart ends it, and
 * three readings keep its state file from reading `running` after that:
 *
 * - the run's settlement writes the code {@link boardRunEnd} answers;
 * - a board that exits writes its own exit code for every run it still holds;
 * - {@link readRunState} reads a `running <pid>` marker whose board is gone,
 *   or whose run this board does not hold, as stopped.
 *
 * A run on the `sdk` runner always runs in this process.
 */
import fs from 'node:fs';
import os from 'node:os';

import { boardRunEnd, type BoardRunRecord } from '@plot-pm/domain/rules/board-run-end';
import {
  NO_EXIT_RECORD,
  STOPPED_RECORD,
  runStateOf,
  type RunMarkerReading,
} from '@plot-pm/domain/rules/run-state';
import { agentRunFor } from './agent-run-for.js';
import { readConfig, type ConfigReadOptions } from './config-reader.js';

/** Reads one `## Plot Config` key, as {@link readConfig} does. */
export type BoardConfigReader = (opts: ConfigReadOptions, key: string, fallback: string) => string;

/** One board role's run, as a route asks for it. */
export interface BoardRunSpec {
  /** The role, such as `idea` or `approve`. */
  readonly role: string;
  /** The `## Plot Config` key naming the role's command, such as `Idea command`. */
  readonly fragmentKey: string;
  /** The tree the role runs in, absolute; a `written` hand-back resolves against it. */
  readonly tree: string;
  /** The prompt text. */
  readonly prompt: string;
  /** The environment the route adds over the board's own. */
  readonly env: Readonly<Record<string, string>>;
  /** Where the run's output is appended. */
  readonly logFile: string;
  /** Where the run's code is recorded; `null` for a route that records none. */
  readonly statePath: string | null;
  /** How long the run may take, in seconds; `0` or absent for no bound. */
  readonly boundSeconds?: number;
  /** The config reader; {@link readConfig} where absent. */
  readonly readCfg?: BoardConfigReader;
  /** Called with the agent process's pid once the run has started it. */
  readonly onStarted?: (pid: number) => void;
  /**
   * Starts the run so that it outlives this process, where the role runs on
   * the `command` runner. The run records its pid in `statePath` and in each
   * of `alsoState`. When it ends, its launcher classifies the exit as
   * {@link boardRunEnd} does for a `command` run (a usage-limit or dropped
   * background exit records `1` with its reason in the log, whatever the
   * status) and records that code. This process does not observe the end and
   * calls no `onEnd`. A role on the `sdk` runner runs in this process as before.
   */
  readonly detached?: { readonly alsoState: readonly string[] };
  /** Called with the detached run's own pid once it is started and marked; not called for a run that is not detached. */
  readonly onDetached?: (pid: number) => void;
}

/** The runs this board process holds: each state file, and its log. */
const held = new Map<string, string>();

let exitListenerInstalled = false;
let signalExitInstalled = false;

/** The signals that end the board. */
const ENDING_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

/**
 * Makes each ending signal exit this process with `128 + signal number`, for
 * the rest of its life.
 *
 * The adapters add a listener for these signals while a run lives and remove
 * it when the run ends. A signal that arrives while a listener exists is
 * caught, and when the run ends before the signal is dispatched, nothing
 * exits: measured on Linux 2026-10-06, a board stopped during a `sleep 3`
 * approve run kept serving for 300 s. A listener that never goes away closes
 * that window.
 */
const installSignalExit = (): void => {
  if (signalExitInstalled) return;
  signalExitInstalled = true;
  for (const signal of ENDING_SIGNALS) process.on(signal, () => process.exit(128 + os.constants.signals[signal]));
};

/** Every run this process started and has not yet recorded. */
const unsettled = new Set<Promise<void>>();

/**
 * Resolves once every run this process started has recorded its end.
 *
 * A test awaits it before it removes the directories its runs write to.
 *
 * @returns a promise that resolves when no run is left unrecorded.
 */
export const boardRunsSettled = async (): Promise<void> => {
  while (unsettled.size > 0) await Promise.all([...unsettled]);
};

const appendLine = (logFile: string, line: string): void => {
  if (line === '') return;
  try {
    fs.appendFileSync(logFile, `\n${line}\n`, 'utf8');
  } catch {
    /* the state file still records the outcome */
  }
};

/**
 * Writes the board's exit code into every state file it still holds, and
 * names the stop in each log. Runs synchronously, as an `exit` listener must.
 *
 * @param code - the board's exit code.
 */
export const endHeldRuns = (code: number): void => {
  const recorded = String(code !== 0 ? code : 1);
  for (const [statePath, logFile] of held) {
    appendLine(logFile, `the board exited with code ${code} before the run ended, and the run ended with it`);
    try {
      fs.writeFileSync(statePath, recorded, 'utf8');
    } catch {
      /* the next read finds the marker's board gone */
    }
  }
  held.clear();
};

/**
 * Records a run's end in a state file that {@link markBoardRun} marked, and
 * releases the board's hold on it.
 *
 * @param statePath - the run's state file; `null` records nothing.
 * @param code - the run's exit code.
 */
export const writeState = (statePath: string | null, code: number): void => {
  if (statePath === null) return;
  held.delete(statePath);
  try {
    fs.writeFileSync(statePath, String(code), 'utf8');
  } catch {
    /* the state file is a convenience; the log is the record */
  }
};

/**
 * Records a run as started by this board, synchronously: `running <pid>
 * <startedAt>` in its state file, with this board's pid and the epoch
 * milliseconds at which that process started — read through
 * {@link processStartedAt}, the source {@link readRunState} compares against,
 * where it answers. Call it before the route answers, so a second request
 * reads the run as running.
 *
 * @param statePath - the run's state file.
 * @param logFile - the run's log, where a board exit names itself.
 * @throws where the state file cannot be written.
 */
export const markBoardRun = (statePath: string, logFile: string): void => {
  if (!exitListenerInstalled) {
    exitListenerInstalled = true;
    process.on('exit', endHeldRuns);
  }
  fs.writeFileSync(statePath, runMarker(process.pid, processStartedAt(process.pid) ?? ownStartedAt()), 'utf8');
  held.set(statePath, logFile);
};

let leftToTheBoard = false;

/**
 * Sets whether this process leaves board-role agents to the running board.
 *
 * A one-shot process sets it: its agents would share its process group and
 * end when it exits, and nothing waits on a brief or a delivery it would start.
 * The running board's next pass starts them instead.
 *
 * @param on - `true` to start no board-role agent in this process.
 */
export const leaveBoardRunsToTheBoard = (on: boolean): void => {
  leftToTheBoard = on;
};

/**
 * Starts one board role through `agentRun` and records its end. Resolves once
 * the run is started; the run itself is not awaited.
 *
 * A `refused` runner choice, a run that cannot start, and every end
 * {@link boardRunEnd} reads as a failure append their reason to the log and
 * record a non-zero code. In a process that {@link leaveBoardRunsToTheBoard},
 * the role starts nothing, appends that to the log, and calls no `onEnd`.
 *
 * @param opts - the board's options.
 * @param spec - the role, its command key, tree, prompt, environment, log and state file.
 * @param onEnd - called with the record once the run ends; a throw is logged and recorded as code `1`.
 * @returns the runner the role started on, `refused` where none could start it.
 */
export const startBoardRun = async (
  opts: ConfigReadOptions,
  spec: BoardRunSpec,
  onEnd?: (record: BoardRunRecord) => void,
): Promise<'command' | 'sdk' | 'refused'> => {
  const finish = (record: BoardRunRecord): void => {
    appendLine(spec.logFile, record.line);
    writeState(spec.statePath, record.code);
    if (!onEnd) return;
    try {
      onEnd(record);
    } catch (err) {
      console.error(`${spec.role} end handler failed:`, err);
      appendLine(spec.logFile, err instanceof Error ? err.message : String(err));
      writeState(spec.statePath, 1);
    }
  };
  const failed = (line: string): BoardRunRecord => ({ code: 1, line, outcome: null, written: null });
  if (leftToTheBoard) {
    const line = `the ${spec.role} run was left to the running board: this process starts no board-role agent`;
    appendLine(spec.logFile, line);
    writeState(spec.statePath, 1);
    console.error(line);
    return 'refused';
  }
  installSignalExit();

  let choice;
  try {
    choice = await agentRunFor(opts, spec.role, spec.fragmentKey, spec.readCfg ?? readConfig);
  } catch (err) {
    finish(failed(`the ${spec.role} run could not start: ${err instanceof Error ? err.message : String(err)}`));
    return 'refused';
  }
  const { agentRun, runner } = choice;
  if (runner === 'refused' || agentRun === undefined) {
    finish(failed(choice.reason));
    return 'refused';
  }
  if (spec.detached && runner === 'command' && choice.detachedRun !== undefined && spec.statePath !== null) {
    const stateFiles = [spec.statePath, ...spec.detached.alsoState];
    const started = await choice.detachedRun.start({
      role: spec.role,
      cwd: spec.tree,
      fragment: choice.fragment,
      prompt: spec.prompt,
      env: spec.env,
      logFile: spec.logFile,
      boundSeconds: spec.boundSeconds ?? 0,
      stateFiles,
    });
    if (!started.ok) {
      finish(failed(`the ${spec.role} run could not start: the launcher did not start it`));
      return 'refused';
    }
    // The launcher owns these files now; this board's exit must not overwrite them.
    for (const file of stateFiles) held.delete(file);
    try {
      spec.onDetached?.(started.value);
    } catch (err) {
      console.error(`${spec.role} start handler failed:`, err);
    }
    return runner;
  }

  const settled: Promise<void> = agentRun
    .run({
      worktree: spec.tree,
      prompt: spec.prompt,
      resumeId: '',
      role: spec.role,
      harness: '',
      model: choice.model,
      effort: '',
      maxTurns: 0,
      maxSpendUsd: 0,
      boundSeconds: spec.boundSeconds ?? 0,
      contextWindow: 0,
      capabilities: [],
      env: spec.env,
      logFile: spec.logFile,
      onStarted: spec.onStarted,
    })
    .then((result) => {
      if (!result.ok) {
        finish(failed(`the ${spec.role} run could not start: ${result.why}`));
        return;
      }
      finish(
        boardRunEnd({
          role: spec.role,
          runner,
          tree: spec.tree,
          end: result.value.end,
          exists: (file) => fs.existsSync(file),
        }),
      );
    })
    .catch((err: unknown) => {
      console.error(`${spec.role} run failed:`, err);
      finish(failed(err instanceof Error ? err.message : String(err)));
    })
    .finally(() => {
      unsettled.delete(settled);
    });
  unsettled.add(settled);
  return runner;
};

/** What a state file and a log say about one run. */
export interface RunState {
  /** `unknown` — no log and no state file; `running`; `done` — code `0`; `failed` — any other record. */
  readonly state: 'unknown' | 'running' | 'done' | 'failed';
  /** The recorded code as written, trimmed; `''` where none is recorded or the run is running. */
  readonly recorded: string;
}

export { STOPPED_RECORD, NO_EXIT_RECORD };

/** Whether a process with this pid exists. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Clock ticks per second in `/proc/<pid>/stat`'s start time — `USER_HZ`,
 * which Linux fixes at 100 for user space on every mainstream architecture.
 */
const USER_HZ = 100;

/** Epoch milliseconds at which this process started, from the monotonic uptime. */
const ownStartedAt = (): number => Math.round(Date.now() - process.uptime() * 1000);

/**
 * Epoch milliseconds at which a process started, read without spawning.
 * Answers from `/proc` where it exists (Linux); null elsewhere, and null for a
 * pid it cannot read — the caller then has no second signal.
 *
 * @param pid - the process to ask about.
 */
export const processStartedAt = (pid: number): number | null => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22 counts clock ticks since boot; the command name (field 2) may hold spaces.
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const boot = /^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf8'));
    if (!boot || !Number.isFinite(ticks)) return null;
    return Number(boot[1]) * 1000 + Math.round((ticks * 1000) / USER_HZ);
  } catch {
    return null;
  }
};

/** A parsed `running <pid> [<startedAt>] [detached]` marker. */
export type RunMarker = RunMarkerReading;

/**
 * The text of a `running` marker.
 *
 * @param pid - the pid of the process that holds the run.
 * @param startedAt - epoch milliseconds at which that process started.
 * @returns `running <pid> <startedAt>`.
 */
export const runMarker = (pid: number, startedAt: number): string => `running ${pid} ${startedAt}`;

/**
 * Parses a state file's content as a `running` marker. Every reader of the
 * marker parses it here, so a marker that gains a field stays readable.
 *
 * @param recorded - the state file's content; surrounding whitespace is ignored.
 * @returns the marker's pid and start time, or `null` where the content is
 *          not a `running` marker — an exit code, or nothing.
 */
export const parseRunMarker = (recorded: string): RunMarker | null => {
  const m = /^running (\d+)(?: (\d+)(?: (detached))?)?$/.exec(recorded.trim());
  return m ? { pid: Number(m[1]), startedAt: m[2] === undefined ? null : Number(m[2]), detached: m[3] !== undefined } : null;
};

/**
 * Reads one run's state from its state file and the log's presence. Never
 * spawns, never blocks, never throws. The rule is {@link runStateOf}.
 *
 * @param statePath - the run's state file.
 * @param logFile - the run's log.
 * @param startedAt - answers when a pid started; defaults to {@link processStartedAt}.
 * @returns the state, and the recorded code where one is recorded.
 */
export const readRunState = (
  statePath: string,
  logFile: string,
  startedAt: (pid: number) => number | null = processStartedAt,
): RunState => {
  let recorded: string | null = null;
  try {
    recorded = fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    /* an unreadable file reads by the log's presence */
  }
  const marker = recorded === null ? null : parseRunMarker(recorded);
  const ownPid = marker?.pid === process.pid;
  return runStateOf({
    recorded,
    logExists: recorded === null && fs.existsSync(logFile),
    marker,
    ownPid,
    held: held.has(statePath),
    alive: marker !== null && alive(marker.pid),
    actualStartedAt: marker === null || marker.startedAt === null || ownPid ? null : startedAt(marker.pid),
  });
};
