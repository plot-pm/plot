import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';

import { answered, failed, unaskable, type PortResult } from '../port-result.js';

/**
 * What a finished process left behind.
 *
 * The exit code is separate from stdout because the contract lives in the
 * code: a non-empty stdout beside a non-zero exit is a partial answer, and
 * only the code says whether it may be read.
 */
export interface ScriptRun {
  /** The exit code; 0 through 4 carry the port contract. */
  code: number;
  /** Everything the process wrote to stdout. */
  stdout: string;
  /** Everything the process wrote to stderr. */
  stderr: string;
}

/** How to run one command. */
export interface RunOptions {
  /** The directory to run in; the process's own when omitted. */
  cwd?: string;
  /** Extra environment on top of the current process's. */
  env?: Readonly<Record<string, string>>;
  /** How long to wait before killing it, in milliseconds. */
  timeoutMs?: number;
  /** How much stdout to keep, in bytes. */
  maxBuffer?: number;
  /**
   * What to write to the process's stdin, for the commands that read a LIST.
   *
   * An argument vector has a length limit that an unbounded list should never
   * be able to reach — a plan estate holds hundreds of files — so the callers
   * that hand over a set send it this way. Honoured by {@link runProcessSync}
   * only; the async path has {@link runBytes}, which also answers in bytes.
   */
  stdin?: string;
}

/** Ten megabytes: the fleet scan's JSON over a large estate exceeds the default. */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/** Two minutes, matching the longest measured scan with headroom. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Five seconds: how long a process group has to act on SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/**
 * Ends a child that leads its own process group, and every process in it.
 *
 * Sends SIGTERM to the whole group first. The group signal reaches the
 * foreground children (`git`, `plot-host.sh`, `bb`) as well as `bash`, so the
 * children end, `bash` regains control, and its TERM trap runs: a script that
 * sources `plot-tmp.sh` removes every temp path it registered. SIGKILL skips
 * that trap.
 *
 * Sends SIGKILL to the group after `graceMs`, whether or not the leader has
 * exited, because a process in the group that ignores TERM outlives the leader
 * (#1084). A group that is already empty makes that SIGKILL a no-op. The grace
 * timer does not keep the Node process alive.
 *
 * The child must have been spawned with `detached: true`, which makes it the
 * group leader. Where the group cannot be signalled, the leader is signalled
 * alone, with SIGTERM and then SIGKILL.
 *
 * @param child - the process to end, spawned detached.
 * @param graceMs - how long to wait between SIGTERM and SIGKILL.
 */
export const killGroup = (child: ChildProcess, graceMs: number = KILL_GRACE_MS): void => {
  const pid = child.pid;
  if (pid === undefined) return;
  let escalate: () => void;
  try {
    process.kill(-pid, 'SIGTERM');
    escalate = () => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // ESRCH: every process in the group has exited.
      }
    };
  } catch {
    child.kill('SIGTERM');
    escalate = () => child.kill('SIGKILL');
  }
  setTimeout(escalate, graceMs).unref();
};

/**
 * Runs a command and reports its exit code and output.
 *
 * The command runs as the leader of its own process group, and a timeout ends
 * the whole group, so nothing it started outlives the answer. A timeout
 * answers code 1 at the timeout, without waiting for the group to exit.
 *
 * Never throws for a non-zero exit: the exit code is the answer, and an
 * exception would make the four contract codes indistinguishable from a
 * missing binary. A process that could not be started at all reports code 1.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param options - where and how to run it.
 * @returns the exit code and both output streams.
 */
export const runProcess = (
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ScriptRun> =>
  new Promise((resolve) => {
    // SPAWN, NOT `execFile`: `execFile` ignores `detached`, so its child joins
    // this process's group and a timeout could signal only `bash`.
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const limit = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    // A STREAM PAST ITS LIMIT ENDS THE GROUP and answers 1, as `execFile`'s
    // `maxBuffer` did, but with nothing it started left running.
    const collect = (chunk: string, into: 'stdout' | 'stderr'): void => {
      if (into === 'stdout') stdout += chunk;
      else stderr += chunk;
      if ((into === 'stdout' ? stdout : stderr).length > limit) {
        killGroup(child);
        finish(1);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: string) => collect(chunk, 'stderr'));
    // A process that could not start at all reports code 1.
    child.on('error', () => finish(1));
    // `close` waits for both streams, so the answer holds everything written.
    // A process ended by a signal has no exit code and reports 1.
    child.on('close', (code) => finish(code ?? 1));
    const timer = setTimeout(() => {
      killGroup(child);
      finish(1);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });


/**
 * Runs a command on the CALLING THREAD and reports its exit code and output.
 *
 * The synchronous twin of {@link runProcess}, and it exists for the callers
 * that are synchronous today. A blocked event loop serves nothing while it
 * runs, so this belongs on a write route where one operator waits for their own
 * click and never on a read path polled by every viewer.
 *
 * Never throws for a non-zero exit, matching {@link runProcess}: an exception
 * would make the four contract codes indistinguishable from a missing binary.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param options - where and how to run it.
 * @returns the exit code and both output streams.
 */
export const runProcessSync = (
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): ScriptRun => {
  try {
    const stdout = execFileSync(command, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      encoding: 'utf8',
      ...(options.stdin === undefined
        ? { stdio: ['ignore', 'pipe', 'pipe'] as const }
        : { input: options.stdin, stdio: ['pipe', 'pipe', 'pipe'] as const }),
    });
    return { code: 0, stdout: stdout ?? '', stderr: '' };
  } catch (error) {
    const thrown = error as { status?: number | null; stdout?: string; stderr?: string };
    return {
      code: typeof thrown.status === 'number' ? thrown.status : 1,
      stdout: thrown.stdout ?? '',
      stderr: thrown.stderr ?? '',
    };
  }
};

/** What a finished process left behind, when its stdout is BYTES. */
export interface ByteRun {
  /** The exit code; 0 through 4 carry the port contract. */
  code: number;
  /** Everything the process wrote to stdout, undecoded. */
  stdout: Buffer;
}

/**
 * Runs a command, feeds it stdin, and answers its stdout in BYTES.
 *
 * The byte-shaped twin of {@link runProcess}, and it exists for exactly the
 * calls whose output cannot survive being decoded first. `git cat-file
 * --batch` frames each entry as `<sha> blob <size>\n<size bytes>\n`, and
 * `size` counts BYTES while a JS string index counts UTF-16 units: one `—` in
 * a file makes the two disagree, and every subsequent entry in the stream
 * would then be sliced at the wrong offset.
 *
 * stdin is the second reason. An object list is unbounded — a plan estate can
 * hold hundreds — and an argument list has a limit such a list should never be
 * able to reach.
 *
 * Never throws for a non-zero exit, matching {@link runProcess}: the code is
 * the answer.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param input - what to write to the process's stdin.
 * @param options - where and how to run it.
 * @returns the exit code and stdout as a buffer.
 */
export const runBytes = (
  command: string,
  args: readonly string[],
  input: string,
  options: RunOptions = {},
): Promise<ByteRun> =>
  new Promise((resolve) => {
    const child = execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: 'buffer',
      },
      (error, stdout) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0) });
      },
    );
    // A closed stdin is how `cat-file --batch` learns the list ended. The
    // error handler is not optional: a process that exits before the write
    // lands raises EPIPE on this stream, and an unhandled one takes the
    // server down rather than reporting a failed read.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });

/**
 * Maps an exit code to a `PortResult`, and is the only place that mapping is
 * written.
 *
 * | exit | result |
 * | --- | --- |
 * | 0 | answered — an empty payload included |
 * | 1 | failed |
 * | 3 | failed — could not be asked |
 * | 4 | unaskable — this backend structurally has no answer |
 *
 * Any other code is `failed`: an unrecognised code is not an answer, and
 * guessing `unaskable` would turn a broken call into a confident "there is
 * none".
 *
 * @param run - the finished process.
 * @param parse - turns the answered stdout into the value; may throw, and a
 *   throw reports `failed`.
 * @returns the parsed value, or which kind of non-answer this was.
 */
export const resultOf = <T>(run: ScriptRun, parse: (stdout: string) => T): PortResult<T> => {
  if (run.code === 4) return unaskable<T>();
  if (run.code !== 0) return failed<T>();
  try {
    return answered(parse(run.stdout));
  } catch {
    return failed<T>();
  }
};

/**
 * Runs a script and maps its exit code into a `PortResult`.
 *
 * The composition of `runProcess` and `resultOf`, and what every adapter
 * calls. Seven adapters writing the mapping themselves is how exit 3 and exit
 * 4 collapse into each other — and collapsing them turns a permanent
 * configuration fact into a transient incident.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param parse - turns the answered stdout into the value.
 * @param options - where and how to run it.
 * @returns the parsed value, or which kind of non-answer this was.
 */
export const runScript = async <T>(
  command: string,
  args: readonly string[],
  parse: (stdout: string) => T,
  options: RunOptions = {},
): Promise<PortResult<T>> => resultOf(await runProcess(command, args, options), parse);

/**
 * Runs a script on the calling thread and maps its exit code into a
 * `PortResult`.
 *
 * The synchronous composition of {@link runProcessSync} and {@link resultOf},
 * and it maps through the SAME `resultOf` the async path uses. That is the
 * point: two mappings would be two readings of 3-versus-4, and the second one
 * is always the one that collapses them.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param parse - turns the answered stdout into the value.
 * @param options - where and how to run it.
 * @returns the parsed value, or which kind of non-answer this was.
 */
export const runScriptSync = <T>(
  command: string,
  args: readonly string[],
  parse: (stdout: string) => T,
  options: RunOptions = {},
): PortResult<T> => resultOf(runProcessSync(command, args, options), parse);

/**
 * Parses stdout as a single JSON document.
 *
 * @param stdout - the process's output.
 * @returns the parsed document.
 */
export const asJson = <T>(stdout: string): T => JSON.parse(stdout) as T;

/**
 * Parses stdout as JSON lines, one document per non-empty line.
 *
 * @param stdout - the process's output.
 * @returns one parsed document per line, in order.
 */
export const asJsonLines = <T>(stdout: string): T[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);

/**
 * Parses stdout as plain lines, dropping empties.
 *
 * @param stdout - the process's output.
 * @returns the non-empty trimmed lines, in order.
 */
export const asLines = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Parses stdout as one trimmed string.
 *
 * @param stdout - the process's output.
 * @returns the output with surrounding whitespace removed.
 */
export const asText = (stdout: string): string => stdout.trim();
