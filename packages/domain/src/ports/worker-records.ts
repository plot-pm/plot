import type { AgentEndReading } from '../rules/worker-ending.js';

/** The record files one desk's worker wrapper writes, absolute. */
export interface WorkerRecordFiles {
  /** `.plot-worker.exit`: the agent's exit code. */
  readonly exitFile: string;
  /** `.plot-worker.pid`: the agent's pid. */
  readonly pidFile: string;
  /** `.plot-worker.pid.startedAt`: the agent's `ps -o lstart=` text. */
  readonly pidStartedFile: string;
  /** `.plot-worker.wrapper.pid`: the wrapper's own pid. */
  readonly wrapperPidFile: string;
}

/**
 * The records a worker wrapper writes about the agent it starts.
 *
 * Every write holds the value alone, with no trailing newline, and reports
 * whether it landed. A failed write is not raised: the agent runs either way.
 */
export interface WorkerRecords {
  /** Writes the wrapper's pid. */
  writeWrapperPid(pid: number): boolean;
  /** Writes the agent's pid. */
  writeAgentPid(pid: number): boolean;
  /** Writes the agent's start time, as {@link WorkerRecords.startedText} read it. */
  writeAgentStarted(text: string): boolean;
  /** Writes the agent's exit code. */
  writeExit(code: number): boolean;
  /**
   * Reads when a process started, as `ps -o lstart=` prints it under `LC_ALL=C`.
   *
   * @returns the text without its trailing newline; `''` when no process has the pid.
   */
  startedText(pid: number): string;
  /**
   * Reads a manifest's `worktree` field.
   *
   * @returns the field verbatim; `''` when the file is absent, unreadable, or holds none.
   */
  manifestWorktree(manifestFile: string): string;
  /** Appends one line to the WorkerMonitor's findings file, `.plot-worker.monitor.worker.jsonl`, in `desk`. */
  appendFinding(desk: string, line: string): boolean;
}

/** An agent process the wrapper started. */
export interface StartedAgent {
  /** The agent's pid. */
  readonly pid: number;
  /** Resolves once with how the agent ended. */
  readonly ended: Promise<AgentEndReading>;
}

/** Starts the agent command a worker wrapper runs. */
export interface AgentStart {
  /**
   * Starts `command` through `sh -c`, attached, in the caller's process group,
   * with the caller's stdio.
   *
   * @param command - the `Worker command` text.
   * @param env - the agent's whole environment.
   * @returns the started agent; `null` when no process started.
   */
  start(command: string, env: Readonly<Record<string, string | undefined>>): StartedAgent | null;
}
