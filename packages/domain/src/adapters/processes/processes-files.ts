import { appendFileSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
import { livenessTokenFifo } from '../liveness-token/liveness-token-fifo.js';
import { monitorTime } from '../../rules/worker-ending.js';
import {
  PASS_FILE,
  RELEASED_WITH_NO_EXIT,
  workerLiveness,
  type TokenReading,
  type LivenessAnswer,
} from '../../rules/worker-liveness.js';

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
  /** Reads the desk's liveness token once; every desk reads `none` where absent. */
  readonly token?: (worktree: string) => TokenReading;
  /** `Worker bound` in milliseconds, read once where a held token needs it; `0` sets no bound. */
  readonly workerBoundMs?: () => Promise<number>;
  /** Records a token released with no exit record in the desk log and the AgentMonitor's findings. */
  readonly recordRelease?: (worktree: string, branch: string, madeAtMs: number) => void;
}

/** One process-table reading, or a function that reads it when a desk first needs it. */
export type TableSource = readonly ProcessRow[] | (() => Promise<readonly ProcessRow[]>);

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
  /** What the liveness rests on: the token, or the start time for a desk with none; absent where no pid was recorded. */
  readonly basis?: 'token' | 'start-time';
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

/** A path's modification time, epoch milliseconds, or `null` where it cannot be read. */
const mtimeOf = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * The last walk per desk that found an agent, with the token and loop-pass
 * readings it was taken under. A read whose two readings match answers `live`
 * and reads no process table.
 */
const walks = new Map<string, { token: string; pass: number | null }>();

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

/**
 * The `orphaned` reading of a desk whose token reads `live`. A desk with no
 * wrapper record is `live`. Otherwise a `live` walk is carried while the token
 * reading and the loop's pass record stay unchanged; the loop rewrites that
 * record at the start of every pass and when its harness starts or ends. Any
 * other answer is not carried: a desk read `orphaned`, or `unaskable`, walks
 * the process table again on its next read.
 */
const tokenWalk = async (
  worktree: string,
  token: TokenReading,
  pid: string,
  rows: () => Promise<readonly ProcessRow[]>,
  io: DeskFilesIo,
  agentProcess: string,
): Promise<PidLiveness> => {
  if (regularFile(join(worktree, WRAPPER_FILE)) === null) return 'live';
  const key = `${token.state} ${token.madeAtMs ?? ''} ${pid}`;
  const pass = mtimeOf(join(worktree, PASS_FILE));
  const last = walks.get(worktree);
  if (last !== undefined && last.token === key && last.pass === pass) return 'live';
  const presence = agentAlive(await rows(), Number(pid), io.now(), { agentProcess, graceSeconds: io.graceSeconds });
  if (presence === 'present') walks.set(worktree, { token: key, pass });
  else walks.delete(worktree);
  return presence === 'absent' ? 'orphaned' : 'live';
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
 * them, a pid is recorded and the liveness is neither `live` nor `stale`, or
 * where `always` is set.
 *
 * A desk whose liveness token is `held` or `released` is decided by
 * {@link workerLiveness} and reads no start time; an exit record older than
 * the token is read as none, and a current one naming a signal death is kept
 * beside a held token that outranks it. A desk with no token takes the start-time path.
 * The process table is read only when a desk needs it.
 *
 * @param worktree - the desk's absolute path.
 * @param table - one reading of the process table, or a function that reads it on first need.
 * @param io - the process questions and the desk's work.
 * @param known - what the caller already read of the desk in this pass.
 * @param always - read `dirty` and the upstream count for every liveness.
 * @returns the readings, the recorded pid and the agent process name.
 */
export const readWorkerReadings = async (
  worktree: string,
  table: TableSource,
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
  const exitPath = join(worktree, EXIT_FILE);
  const exitText = regularFile(exitPath);
  let exit = exitText === null ? null : exitText.replace(/[ \n]/g, '');
  const rows = async (): Promise<readonly ProcessRow[]> => (typeof table === 'function' ? table() : table);

  const token = io.token?.(worktree) ?? { state: 'none', madeAtMs: null };
  let answer: LivenessAnswer = { basis: 'start-time' };
  let liveness: PidLiveness = 'dead';
  if (pidRecorded && token.state !== 'none') {
    const startedMs = Date.parse(startedAt);
    const exitAtMs = exitText === null ? null : mtimeOf(exitPath);
    const pidAnswers = io.signalZero(Number(pid)) === true;
    const needsBound = token.state === 'held' && !pidAnswers;
    answer = workerLiveness({
      exitAtMs,
      exitCode: exit !== null && /^\d+$/.test(exit) ? Number(exit) : null,
      token,
      pidAnswers,
      startedAtMs: Number.isNaN(startedMs) ? null : startedMs,
      nowMs: io.now(),
      workerBoundMs: needsBound && io.workerBoundMs !== undefined ? await io.workerBoundMs() : 0,
    });
  }
  if (answer.basis === 'token') {
    if (!answer.exitCurrent) exit = null;
    if (answer.liveness === 'stray-holder') liveness = 'stray-holder';
    else if (answer.liveness === 'live') liveness = await tokenWalk(worktree, token, pid, rows, io, agentProcess);
    else if (answer.liveness === 'dead' && token.state === 'released') {
      io.recordRelease?.(worktree, manifest === null ? '' : manifestField(manifest, 'branch'), token.madeAtMs ?? 0);
    }
  } else if (pidRecorded && io.signalZero(Number(pid)) === true) {
    const n = Number(pid);
    let current = true;
    if (startedAt !== '' || pidStartedAt !== '') {
      const row = (await rows()).find((r) => r.pid === n);
      const start = row !== undefined ? row.startedAt : await io.startedAt(n);
      // A pid missing from the table and still without a start is not decided stale.
      current = row === undefined && start === null ? true : pidIsCurrent({ startedAt, pidStartedAt }, start);
    }
    if (!current) liveness = 'stale';
    else if (regularFile(join(worktree, WRAPPER_FILE)) === null) liveness = 'live';
    else {
      const presence = agentAlive(await rows(), n, io.now(), { agentProcess, graceSeconds: io.graceSeconds });
      liveness = presence === 'absent' ? 'orphaned' : 'live';
    }
  }

  let blocked = false;
  try {
    blocked = readdirSync(worktree).some((name) => name.startsWith(MARKER_PREFIX));
  } catch {
    blocked = false;
  }

  const wantsTask = always || (pidRecorded && liveness !== 'live' && liveness !== 'stale');
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
    ...(pidRecorded ? { basis: answer.basis } : {}),
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
 * @returns the state, the pid, the exit code and the liveness basis; no activity.
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
    ...(gathered.basis === undefined ? {} : { basis: gathered.basis }),
  };
};

/** The AgentMonitor's findings file inside a desk. */
const AGENT_FINDINGS_FILE = '.plot-worker.monitor.agent.jsonl';
/** The desk log. */
const DESK_LOG_FILE = '.plot-worker.log';

/**
 * Writes one line to the desk log and one `WorkerMonitor` `gone` line to the
 * AgentMonitor's findings for a token released with no exit record, once per
 * token: a findings file that already carries the token's evidence gets no
 * second line.
 *
 * @param worktree - the desk.
 * @param branch - the branch the manifest names; `''` where none does.
 * @param madeAtMs - the token's modification time, which names the token in the evidence.
 * @param nowMs - the time of the write.
 * @returns whether a line was written.
 */
export const recordTokenRelease = (worktree: string, branch: string, madeAtMs: number, nowMs: number): boolean => {
  const evidence = `${RELEASED_WITH_NO_EXIT} (token made ${monitorTime(madeAtMs)})`;
  const findings = join(worktree, AGENT_FINDINGS_FILE);
  if ((regularFile(findings) ?? '').includes(JSON.stringify(evidence))) return false;
  const at = monitorTime(nowMs);
  const line = { monitor: 'WorkerMonitor', branch, worktree, finding: 'gone', since: at, evidence, measuredAt: at };
  try {
    appendFileSync(findings, `${JSON.stringify(line)}\n`);
    appendFileSync(join(worktree, DESK_LOG_FILE), `plot-fleetd: ${worktree}: ${evidence}\n`);
    return true;
  } catch {
    return false;
  }
};

/** `Worker bound` per repository root, in milliseconds, read once per process. */
const workerBounds = new Map<string, Promise<number>>();

/** The loop's own default for `Worker bound`, in seconds. */
const DEFAULT_WORKER_BOUND_SECONDS = 28_800;

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
  /** Reads a desk's liveness token; the FIFO adapter by default. */
  readonly token?: (worktree: string) => TokenReading;
  /** `Worker bound` in seconds; `PLOT_WORKER_BOUND`, then the config key, when absent. */
  readonly workerBoundSeconds?: number;
  /** Writes the desk log line and the finding for a token released with no exit record; fleetd sets it. */
  readonly recordRelease?: boolean;
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
  const workerBoundMs = (): Promise<number> => {
    if (options.workerBoundSeconds !== undefined) return Promise.resolve(options.workerBoundSeconds * 1000);
    const given = process.env.PLOT_WORKER_BOUND ?? '';
    if (/^\d+$/.test(given)) return Promise.resolve(Number(given) * 1000);
    const known = workerBounds.get(context.repoRoot);
    if (known !== undefined) return known;
    const reading = scriptsShell({ ...context, repoRoot: mainRootOf(context.repoRoot) }, answers)
      .config('Worker bound', '')
      .then((answer) => {
        const text = answer.ok ? answer.value.trim() : '';
        return (/^\d+$/.test(text) ? Number(text) : DEFAULT_WORKER_BOUND_SECONDS) * 1000;
      });
    workerBounds.set(context.repoRoot, reading);
    return reading;
  };
  const tokens = livenessTokenFifo(options.log === undefined ? {} : { log: options.log });
  const now = options.now ?? Date.now;
  return async () => ({
    token: options.token ?? tokens.read,
    workerBoundMs,
    ...(options.recordRelease === true
      ? { recordRelease: (worktree: string, branch: string, madeAtMs: number) => void recordTokenRelease(worktree, branch, madeAtMs, now()) }
      : {}),
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
    now,
    graceSeconds,
    agentProcess: process.env.PLOT_AGENT_PROCESS || DEFAULT_AGENT_PROCESS,
    ...(options.log !== undefined ? { log: options.log } : {}),
  });
};

/**
 * Reads worker state from the desk files and one process-table reading per
 * pass, and decides it with {@link agentState}.
 *
 * The first `table` call, or the first `workerState` call for a desk that
 * needs the table, reads it; a desk whose liveness token answers reads no
 * table unless its `orphaned` walk is due. Every call within
 * `tableHoldMs` of that reading, or while it is in flight, reuses it, across
 * every instance in this process that shares the process runner. A `ps`
 * that exits non-zero fails every call that shares the reading and logs
 * `process table unreadable (ps exit <code>)` once.
 *
 * @param context - where the scripts and the repository are.
 * @param options - the seams and the log.
 * @returns a `Processes` that starts at most one `ps` per pass for its worker states.
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
      let unreadable = false;
      const rows = async (): Promise<readonly ProcessRow[]> => {
        const read = await tableRead();
        if (read.ok) return read.rows;
        unreadable = true;
        return [];
      };
      const gathered = await readWorkerReadings(worktree, rows, await io(), known);
      if (unreadable) return failed<ProcessReading>();
      return answered(processReadingOf(gathered, hasPr));
    },
  };
};
