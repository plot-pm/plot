import { execFile } from 'node:child_process';

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
}

/** Ten megabytes: the fleet scan's JSON over a large estate exceeds the default. */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/** Two minutes, matching the longest measured scan with headroom. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Runs a command and reports its exit code and output.
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
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });


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
