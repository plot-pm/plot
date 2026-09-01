import type { PortResult } from '../port-result.js';

/**
 * A detached run's identity, as the caller needs it.
 *
 * The pid is what a caller records so a later reading can ask the process
 * table about it. `started: false` means the process never came up — a caller
 * that logs a start it did not get would report a worker that does not exist.
 */
export interface StartedRun {
  /** The child's process id, or `0` where the spawn itself failed. */
  pid: number;
  /** Whether the process was started at all. */
  started: boolean;
}

/**
 * What the host answered, with the evidence a refusal carries.
 *
 * `unaskable` is exit 4 — this backend has no such capability at all — and
 * `failed` is anything else non-zero. The distinction is made once, inside the
 * adapter, so no caller reads a number; what a caller still needs is the
 * SENTENCE, because a rate limit and a DNS blip are both `failed` and only one
 * of them is worth waiting for.
 *
 * So the classification and the evidence travel together. Collapsing them was
 * the measured defect either way round: dropping the sentence makes every
 * failure look alike, and handing back the code makes exit 4 look like an
 * outage a caller should retry.
 */
export type HostAnswer =
  | { answer: 'answered'; stdout: string }
  | { answer: 'failed'; said: string }
  | { answer: 'unaskable'; said: string };

/** How to run one script. */
export interface ScriptOptions {
  /** How long to wait before killing it, in milliseconds. */
  timeoutMs?: number;
  /** How much stdout to keep, in bytes. */
  maxBuffer?: number;
  /** Extra environment on top of the current process's. */
  env?: Readonly<Record<string, string>>;
}

/** How to start a detached script. */
export interface StartOptions {
  /** An open file descriptor both stdout and stderr are written to. */
  log?: number;
  /**
   * Called when the child exits, with its code and the signal that killed it.
   *
   * Passing this implies {@link StartOptions.keepAlive}: a caller waiting on an
   * exit needs the process to still be there when it arrives.
   */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Called when the child could not be spawned. */
  onError?: (error: Error) => void;
  /**
   * Whether the handle stays referenced — set by passing {@link StartOptions.onExit}.
   *
   * A detached start is normally unreferenced, because the script outlives the
   * request and nothing waits for it. A caller CHAINED to the exit code is the
   * exception: dropping the handle drops what it is waiting for, and the
   * measured shape of that is every delivery landing and nothing ever being
   * reaped.
   */
  keepAlive?: boolean;
}

/** How to stream a script's output. */
export interface StreamOptions extends ScriptOptions {
  /** Called with each complete stderr line. */
  onErrorLine?: (line: string) => void;
}

/**
 * Runs Plot's own helper scripts — the ONE place `plot-*.sh` is invoked.
 *
 * Every operation names a script by its ROLE rather than its filename, so no
 * caller holds a path and no caller reads an exit code. That second property is
 * the one this port exists for: `plot-host.sh` distinguishes *this host cannot
 * be asked* (exit 4) from *this attempt failed* (exit 1 or 3), and a caller
 * that re-reads the number collapses a permanent configuration fact into a
 * transient incident — so it retries something that will never work.
 *
 * The port carries the INVOCATION and not the shape of what comes back. Each
 * operation answers the script's stdout verbatim, because the scripts are the
 * plan-format and host contracts and a second parse here would be a second
 * spelling of them. What the caller may not do is decide what a non-zero exit
 * meant; {@link PortResult} has already decided.
 *
 * `askSync` blocks the calling thread and is on the port because the write
 * routes that need it are synchronous today. Making them async is a separate
 * migration with its own test ripple; moving the invocation is this one.
 */
export interface Scripts {
  /**
   * Reads plan files through `plot-plan-meta.sh`, the plan-format contract.
   *
   * @param files - the plan paths to parse, absolute or repository-relative.
   * @param options - how to run it.
   * @returns the parser's stdout, one JSON document per line.
   */
  planMeta(files: readonly string[], options?: ScriptOptions): Promise<PortResult<string>>;

  /**
   * Reads plan files through `plot-plan-meta.sh`, blocking the calling thread.
   *
   * @param files - the plan paths to parse.
   * @param options - how to run it.
   * @returns the parser's stdout, one JSON document per line.
   */
  planMetaSync(files: readonly string[], options?: ScriptOptions): PortResult<string>;

  /**
   * Reads one `## Plot Config` key through `plot-config.sh`.
   *
   * @param key - the key as it appears in the config section.
   * @param fallback - what the script answers with when the key is absent.
   * @returns the configured value, trimmed.
   */
  config(key: string, fallback: string, options?: ScriptOptions): Promise<PortResult<string>>;

  /**
   * Reads one `## Plot Config` key, blocking the calling thread.
   *
   * @param key - the key as it appears in the config section.
   * @param fallback - what the script answers with when the key is absent.
   * @returns the configured value, trimmed.
   */
  configSync(key: string, fallback: string, options?: ScriptOptions): PortResult<string>;

  /**
   * Asks `plot-host.sh` one question.
   *
   * The host is the one connector, and exit 4 is its standing answer that this
   * backend has no such capability at all. It arrives as `unaskable` and never
   * as a failure, which is the whole reason this call does not hand back a
   * number.
   *
   * @param args - the subcommand and its arguments, as the script takes them.
   * @param options - how to run it.
   * @returns the script's stdout.
   */
  host(args: readonly string[], options?: ScriptOptions): Promise<PortResult<string>>;

  /**
   * Asks `plot-host.sh` one question, keeping what it said on a refusal.
   *
   * The same call as {@link Scripts.host} for a caller that must tell a rate
   * limit from a DNS failure. Both are `failed`; only the first is worth
   * backing off from, and the host's own sentence is the only evidence either
   * way.
   *
   * @param args - the subcommand and its arguments.
   * @param options - how to run it.
   * @returns which of the three answers this was, with stdout or the sentence.
   */
  hostSaid(args: readonly string[], options?: ScriptOptions): Promise<HostAnswer>;

  /**
   * Runs a script to completion and hands back everything it said.
   *
   * FOR THE SCRIPTS THAT EXPLAIN THEMSELVES ON THE WAY OUT, and only those.
   * `plot-dispatch.sh` exits non-zero for refusals of its own — a phase gate,
   * an unresolvable `origin/<main>` — while still reporting on stdout which
   * branches it claimed, and `plot-approve.sh` writes its refusal across
   * several stderr lines whose continuation is the part that says what to do.
   * A `PortResult` would discard one of those in each case.
   *
   * The exit code is here because a caller of THIS operation is reading a
   * script Plot itself ships and whose refusals Plot itself wrote. It is not
   * the host contract: no caller may read `4` off it and conclude anything —
   * that reading is {@link Scripts.hostSaid}'s, and it is made once.
   *
   * @param script - the script's filename.
   * @param args - its arguments.
   * @param options - how to run it.
   * @returns stdout, stderr and the exit code.
   */
  awaited(
    script: string,
    args: readonly string[],
    options?: ScriptOptions,
  ): Promise<{ stdout: string; stderr: string; code: number }>;

  /**
   * Starts a script detached, answering as soon as it is running.
   *
   * The answer is that it STARTED, never what it did: these scripts outlive the
   * request that started them, and a response carrying a result would have to
   * wait for one.
   *
   * @param script - the script's filename, such as `plot-deliver.sh`.
   * @param args - its arguments.
   * @param options - where its output goes and what to call on exit.
   * @returns the child's pid, and whether it started at all.
   */
  start(script: string, args: readonly string[], options?: StartOptions): StartedRun;

  /**
   * Streams a script's stdout, one complete line at a time.
   *
   * @param script - the script's filename.
   * @param args - its arguments.
   * @param onLine - called with each non-empty stdout line, in order.
   * @param options - how to run it, and where stderr lines go.
   * @returns nothing on a clean exit; rejects on a non-zero exit or a timeout.
   */
  stream(
    script: string,
    args: readonly string[],
    onLine: (line: string) => void,
    options?: StreamOptions,
  ): Promise<void>;

  /**
   * Sources a script and runs a shell program that calls its functions.
   *
   * FOR THE SCRIPTS THAT ARE SOURCED RATHER THAN RUN. `plot-worker-state.sh`
   * defines `plot_worker_state` and both `plot-dispatch.sh` and
   * `plot-fleet-scan.sh` source it, which is how one computation stays one
   * implementation — so a caller here does the same rather than reimplementing
   * eight states.
   *
   * The script's path arrives as `$1` and the caller's arguments follow it, so
   * the program begins `. "$1"; shift`.
   *
   * @param script - the script's filename.
   * @param program - the shell program to run with the script sourced.
   * @param args - positional arguments after the script's path.
   * @param options - how to run it.
   * @returns the program's stdout.
   */
  sourced(
    script: string,
    program: string,
    args: readonly string[],
    options?: ScriptOptions,
  ): PortResult<string>;

  /**
   * The absolute path of one helper script.
   *
   * The single concession to callers that must name a script without running
   * it — a log line, or an `existsSync` probe. It reaches the filesystem and
   * never the process table, so it cannot carry an exit code to misread.
   *
   * @param script - the script's filename.
   * @returns its absolute path.
   */
  pathOf(script: string): string;
}
