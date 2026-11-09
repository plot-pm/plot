import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { KnownDeskReadings, Processes, ProcessReading } from '../../ports/processes.js';
import { agentState, type AgentStateReadings, type PidLiveness } from '../../rules/agent-state.js';
import { deskWaitsFree, FREE_WAIT_FILENAME } from '../../rules/desk-loop-alive.js';
import { deskManifest, manifestDirectory } from '../../rules/desk-manifest.js';
import {
  agentAlive,
  DEFAULT_AGENT_GRACE_SECONDS,
  DEFAULT_AGENT_PROCESS,
  pidIsCurrent,
  type ProcessRow,
} from '../../rules/pid-current.js';
import { processAnswers, scriptRunner, type FixedAnswers, type ProcessRunner } from '../git-dirs/git-dirs.js';
import { mainRootOf } from '../main-checkout.js';
import { runProcess } from '../run-script.js';
import type { ShellContext } from '../scripts.js';
import { scriptsShell } from '../scripts/scripts-shell.js';
import { signalZero } from '../signal-zero.js';
import { treesGit } from '../trees/trees-git.js';
import { processesShell } from './processes-shell.js';
import { processesTable, type TableRead } from './processes-table.js';

/** What {@link readWorkerReadings} reads beside the files: the process questions and the desk's work. */
export interface DeskFilesIo {
  /** The `Agent registry` directory, absolute. */
  readonly manifestDir: string;
  /** `kill -0`: true alive, false gone, null unaskable. */
  readonly signalZero: (pid: number) => boolean | null;
  /** One fresh start-time read of a pid the table does not hold; `null` where none. */
  readonly startedAt: (pid: number) => Promise<number | null>;
  /** Whether the dirt filter finds uncommitted work in the desk. */
  readonly dirty: (worktree: string) => Promise<boolean>;
  /** `git rev-list --count @{upstream}..HEAD` in the desk, or `''` where git cannot count. */
  readonly ahead: (worktree: string) => Promise<string>;
  /** The current time, epoch milliseconds. */
  readonly now: () => number;
  /** The grace before an empty wrapper subtree counts, in seconds. */
  readonly graceSeconds: number;
  /** The agent process name for a desk whose manifest names none. */
  readonly agentProcess: string;
  /** Receives one line per desk the first time its agent process name is read. */
  readonly log?: (line: string) => void;
}

/** What {@link readWorkerReadings} gathers for one desk. */
export interface GatheredReadings {
  /** The readings {@link agentState} takes, with `hasPr` set to `false`. */
  readonly readings: AgentStateReadings;
  /** The recorded pid, or `''` where none was recorded. */
  readonly pid: string;
  /** The upstream count as git printed it, `''` where unanswered or not read. */
  readonly ahead: string;
  /** The agent process name the desk's manifest names, or the default. */
  readonly agentProcess: string;
}

/** The desk's own record of the pid it launched. */
const PID_FILE = '.plot-worker.pid';
/** The recorded pid's own start, beside the pid file. */
const PID_STARTED_FILE = '.plot-worker.pid.startedAt';
/** The file the wrapper writes; its presence proves Plot launched a worker here. */
const WRAPPER_FILE = '.plot-worker.wrapper.pid';
/** The recorded exit code. */
const EXIT_FILE = '.plot-worker.exit';
/** The prefix of a marker file at the desk's root. */
const MARKER_PREFIX = 'PLOT-BLOCKED';

/** A file's text, or `null` where it is not a regular file or cannot be read. */
const regularFile = (path: string): string | null => {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/** Whether a path is a directory. */
const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A path through `realpath`, or `''` where it cannot be resolved. */
const realOrEmpty = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
};

/**
 * One string field of a pretty-printed manifest, read as
 * `plot-worker-state.sh` reads it: the first line naming the field, then the
 * last `"<field>": "<value>"` on that line. A line that names the field
 * without a string value is returned whole, as `sed` leaves it.
 */
const manifestField = (text: string, field: string): string => {
  const line = text.split('\n').find((l) => l.includes(`"${field}":`));
  if (line === undefined) return '';
  const m = new RegExp(`.*"${field}": *"([^"]*)".*`).exec(line);
  return m === null ? line : m[1]!;
};

/** The manifest that names the desk, as text, or `null` where none or several do. */
const manifestOf = (manifestDir: string, worktree: string): string | null => {
  let names: string[];
  try {
    names = readdirSync(manifestDir);
  } catch {
    return null;
  }
  const texts = new Map<string, string>();
  const manifests = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const path = join(manifestDir, name);
    const text = regularFile(path);
    if (text === null) continue;
    const field = manifestField(text, 'worktree');
    texts.set(path, text);
    manifests.push({ path, worktree: field, worktreeReal: field === '' ? '' : realOrEmpty(field) });
  }
  const named = deskManifest({ desk: worktree, deskReal: realOrEmpty(worktree), manifests });
  return named.kind === 'named' ? (texts.get(named.path) ?? null) : null;
};

/** The desks whose agent process name was already logged in this process. */
const loggedDesks = new Set<string>();

/**
 * Gathers the readings of one desk that `plot_worker_readings` prints, from
 * the desk's files, its manifest, one process-table reading and `kill -0`.
 *
 * The manifest names the pid, `startedAt`, `pidStartedAt` and the agent
 * process name; `io.agentProcess` stands in where it names none. The pid file
 * and its `startedAt` sidecar stand in where no manifest names a pid and a
 * `startedAt`. A pid that answers `kill -0` and is missing from the table has
 * its start read once more; with no start, its staleness is not decided.
 * `dirty` and the upstream count are read only where `known` does not carry
 * them and the liveness is neither `live` nor `stale`, or where `always` is set.
 *
 * @param worktree - the desk's absolute path.
 * @param table - one reading of the process table.
 * @param io - the process questions and the desk's work.
 * @param known - what the caller already read of the desk in this pass.
 * @param always - read `dirty` and the upstream count for every liveness.
 * @returns the readings, the recorded pid and the agent process name.
 */
export const readWorkerReadings = async (
  worktree: string,
  table: readonly ProcessRow[],
  io: DeskFilesIo,
  known: KnownDeskReadings = {},
  always = false,
): Promise<GatheredReadings> => {
  const empty = { hasPr: false, blocked: false, dirty: false, unpushed: null };
  if (worktree === '' || !isDirectory(worktree)) {
    return {
      readings: { worktreeHere: false, pidRecorded: false, liveness: 'dead', exit: null, task: empty },
      pid: '',
      ahead: '',
      agentProcess: DEFAULT_AGENT_PROCESS,
    };
  }

  const manifest = manifestOf(io.manifestDir, worktree);
  let pid = '';
  let startedAt = '';
  let pidStartedAt = '';
  if (manifest !== null) {
    const fields = [manifestField(manifest, 'pid'), manifestField(manifest, 'startedAt'), manifestField(manifest, 'pidStartedAt')];
    if (fields[0] !== '' && fields[1] !== '') [pid, startedAt, pidStartedAt] = fields as [string, string, string];
  }
  if (pid === '') {
    pid = (regularFile(join(worktree, PID_FILE)) ?? '').replace(/[ \n]/g, '');
    pidStartedAt = (regularFile(join(worktree, PID_STARTED_FILE)) ?? '').replace(/\n/g, '');
  }
  const agentProcess = (manifest === null ? '' : manifestField(manifest, 'agentProcess')) || io.agentProcess;
  if (!loggedDesks.has(worktree)) {
    loggedDesks.add(worktree);
    io.log?.(`desk ${worktree}: agent process ${agentProcess}`);
  }

  const pidRecorded = /^\d+$/.test(pid) && pid !== '0';
  let liveness: PidLiveness = 'dead';
  if (pidRecorded && io.signalZero(Number(pid)) === true) {
    const n = Number(pid);
    const row = table.find((r) => r.pid === n);
    let current = true;
    if (startedAt !== '' || pidStartedAt !== '') {
      const start = row !== undefined ? row.startedAt : await io.startedAt(n);
      // A pid missing from the table and still without a start is not decided stale.
      current = row === undefined && start === null ? true : pidIsCurrent({ startedAt, pidStartedAt }, start);
    }
    if (!current) liveness = 'stale';
    else if (regularFile(join(worktree, WRAPPER_FILE)) === null) liveness = 'live';
    else {
      const presence = agentAlive(table, n, io.now(), { agentProcess, graceSeconds: io.graceSeconds });
      liveness = presence === 'absent' ? 'orphaned' : 'live';
    }
  }

  const exitText = regularFile(join(worktree, EXIT_FILE));
  const exit = exitText === null ? null : exitText.replace(/[ \n]/g, '');

  let blocked = false;
  try {
    blocked = readdirSync(worktree).some((name) => name.startsWith(MARKER_PREFIX));
  } catch {
    blocked = false;
  }

  const wantsTask = always || (liveness !== 'live' && liveness !== 'stale');
  const dirty = known.dirty ?? (wantsTask ? await io.dirty(worktree) : false);
  const ahead = known.allPushed === true ? '0' : wantsTask ? await io.ahead(worktree) : '';
  const count = Number(ahead);
  const unpushed = ahead !== '' && Number.isInteger(count) && count >= 0 ? count > 0 : null;

  return {
    readings: {
      worktreeHere: true,
      pidRecorded,
      liveness,
      exit,
      task: { hasPr: false, blocked, dirty, unpushed },
      waitsFree: deskWaitsFree({ text: regularFile(join(worktree, FREE_WAIT_FILENAME)) }, pid),
      startedAtRecorded: startedAt !== '',
    },
    pid: pidRecorded ? pid : '',
    ahead,
    agentProcess,
  };
};

/**
 * The tab-separated line `plot_worker_readings` prints for the same readings.
 *
 * @param gathered - what {@link readWorkerReadings} answered.
 * @returns `here pid liveness exit blocked dirty unpushed free_wait`.
 */
export const readingsLine = (gathered: GatheredReadings): string => {
  const r = gathered.readings;
  return [
    r.worktreeHere ? '1' : '0',
    r.pidRecorded ? '1' : '0',
    r.liveness,
    r.exit === null ? '-' : r.exit,
    r.task.blocked ? '1' : '0',
    r.task.dirty ? '1' : '0',
    gathered.ahead,
    r.waitsFree === true && r.startedAtRecorded === true ? '1' : '0',
  ].join('\t');
};

/**
 * The reading `plot_worker_state` prints for gathered readings.
 *
 * @param gathered - what {@link readWorkerReadings} answered.
 * @param hasPr - whether the branch has a PR.
 * @returns the state, the pid and the exit code; no activity.
 */
export const processReadingOf = (gathered: GatheredReadings, hasPr: boolean): ProcessReading => {
  const r = gathered.readings;
  if (!r.worktreeHere) return { state: 'none', pid: '', exitCode: '', activity: '' };
  const state = agentState({ ...r, task: { ...r.task, hasPr } });
  const numericExit = r.liveness === 'dead' && r.exit !== null && /^\d+$/.test(r.exit);
  return {
    state,
    pid: state === 'none' ? '' : gathered.pid,
    exitCode: numericExit ? (r.exit as string) : '',
    activity: '',
  };
};

/** The `Agent registry` directory per repository root, resolved once per process. */
const manifestDirs = new Map<string, Promise<string>>();

/** Resolves the `Agent registry` directory for a repository once per process. */
const manifestDirOf = (context: ShellContext, answers: FixedAnswers): Promise<string> => {
  const known = manifestDirs.get(context.repoRoot);
  if (known !== undefined) return known;
  const resolving = (async () => {
    const mainCheckout = mainRootOf(context.repoRoot);
    const answer = await scriptsShell({ ...context, repoRoot: mainCheckout }, answers).config('Agent registry', '', {
      env: { PLOT_REPO_ROOT: mainCheckout },
    });
    return manifestDirectory({ mainCheckout, configured: answer.ok ? answer.value : '' });
  })();
  manifestDirs.set(context.repoRoot, resolving);
  return resolving;
};

/** What a caller of {@link processesFiles} may set. */
export interface ProcessesFilesOptions {
  /** The `Agent registry` directory; `PLOT_MANIFEST_DIR`, then `## Plot Config`, when absent. */
  readonly manifestDir?: string;
  /** How long one table reading serves later calls, in milliseconds. */
  readonly tableHoldMs?: number;
  /** Receives a line when the process table cannot be read and when a desk's agent process name is first read. */
  readonly log?: (line: string) => void;
  /** Starts processes; {@link runProcess} by default. */
  readonly run?: ProcessRunner;
  /** The held repository answers. */
  readonly answers?: FixedAnswers;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
  /** `kill -0`; {@link signalZero} by default. */
  readonly signalZero?: (pid: number) => boolean | null;
}

/**
 * The last table reading per process runner. Every `processesFiles` of this
 * process that starts its processes through the same runner shares it, so
 * sites that construct one per call still read one table per pass.
 */
const heldTables = new WeakMap<ProcessRunner, { at: number; reading: Promise<TableRead> }>();

/** One table reading serves the calls of one pass: less than one 5 s fleet beat. */
const DEFAULT_TABLE_HOLD_MS = 4_000;

/**
 * Builds the {@link DeskFilesIo} a {@link processesFiles} reads with.
 *
 * The grace comes from `PLOT_AGENT_GRACE_SECONDS`, 30 s where unset; the
 * agent process name for a desk whose manifest names none from
 * `PLOT_AGENT_PROCESS`, `claude` where unset; the
 * registry directory from `options.manifestDir`, then `PLOT_MANIFEST_DIR`,
 * then the `Agent registry` key, resolved once per process.
 *
 * @param context - where the scripts and the repository are.
 * @param options - the seams and the log.
 * @returns a function that answers the io, resolving the registry directory on first use.
 */
export const deskFilesIo = (context: ShellContext, options: ProcessesFilesOptions = {}): (() => Promise<DeskFilesIo>) => {
  const run = options.run ?? runProcess;
  const answers = options.answers ?? processAnswers;
  const trees = treesGit(context, answers);
  const runScripted = scriptRunner(context.repoRoot, answers, run);
  const graceText = process.env.PLOT_AGENT_GRACE_SECONDS ?? '';
  const graceSeconds = /^\d+$/.test(graceText) ? Number(graceText) : DEFAULT_AGENT_GRACE_SECONDS;
  const manifestDir = async (): Promise<string> => {
    if (options.manifestDir !== undefined) return options.manifestDir;
    const given = process.env.PLOT_MANIFEST_DIR ?? '';
    return given !== '' ? given : manifestDirOf(context, answers);
  };
  return async () => ({
    manifestDir: await manifestDir(),
    signalZero: options.signalZero ?? signalZero,
    startedAt: processesTable(run).startedAt,
    dirty: async (worktree) => {
      const paths = await trees.dirtyPaths(worktree);
      return paths.ok && paths.value.length > 0;
    },
    ahead: async (worktree) => {
      const ran = await runScripted('git', ['-C', worktree, 'rev-list', '--count', '@{upstream}..HEAD'], { cwd: context.repoRoot });
      return ran.code === 0 ? ran.stdout.trim() : '';
    },
    now: options.now ?? Date.now,
    graceSeconds,
    agentProcess: process.env.PLOT_AGENT_PROCESS || DEFAULT_AGENT_PROCESS,
    ...(options.log !== undefined ? { log: options.log } : {}),
  });
};

/**
 * Reads worker state from the desk files and one process-table reading per
 * pass, and decides it with {@link agentState}.
 *
 * The first `workerState` or `table` call reads the table; every call within
 * `tableHoldMs` of that reading, or while it is in flight, reuses it, across
 * every instance in this process that shares the process runner. A `ps`
 * that exits non-zero fails every call that shares the reading and logs
 * `process table unreadable (ps exit <code>)` once.
 *
 * @param context - where the scripts and the repository are.
 * @param options - the seams and the log.
 * @returns a `Processes` that starts one `ps` per pass for its worker states.
 */
export const processesFiles = (context: ShellContext, options: ProcessesFilesOptions = {}): Processes => {
  const now = options.now ?? Date.now;
  const holdMs = options.tableHoldMs ?? DEFAULT_TABLE_HOLD_MS;
  const ps = processesTable(options.run ?? runProcess);
  const io = deskFilesIo(context, options);

  const run = options.run ?? runProcess;
  const tableRead = (): Promise<TableRead> => {
    const at = now();
    const held = heldTables.get(run);
    if (held !== undefined && at - held.at < holdMs) return held.reading;
    const reading = ps.read().then((read) => {
      if (!read.ok) options.log?.(`process table unreadable (ps exit ${read.code})`);
      return read;
    });
    heldTables.set(run, { at, reading });
    return reading;
  };

  return {
    ...processesShell(context, options.answers ?? processAnswers),

    table: async () => {
      const read = await tableRead();
      return read.ok ? answered(read.rows) : failed();
    },

    workerState: async (worktree, hasPr, known): Promise<PortResult<ProcessReading>> => {
      const read = await tableRead();
      if (!read.ok) return failed<ProcessReading>();
      const gathered = await readWorkerReadings(worktree, read.rows, await io(), known);
      return answered(processReadingOf(gathered, hasPr));
    },
  };
};
