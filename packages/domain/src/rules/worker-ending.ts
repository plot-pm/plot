/** How an agent process ended: an exit code, or the number of the signal that ended it. */
export interface AgentEndReading {
  /** The exit code; `null` when a signal ended the process. */
  readonly code: number | null;
  /** The number of the signal that ended the process; `null` for a normal exit. */
  readonly signal: number | null;
}

/** What the WorkerMonitor reports when an agent ends. */
export interface AgentEnding {
  /** `clear` for exit 0, `gone` for every other code. */
  readonly finding: 'clear' | 'gone';
  /** The sentence the finding carries. */
  readonly evidence: string;
}

/** One WorkerMonitor line to append to a desk. */
export interface EndingLineInput {
  /** The branch the agent held. */
  readonly branch: string;
  /** The desk the line names, after a hop. */
  readonly desk: string;
  /** The ending to report. */
  readonly ending: AgentEnding;
  /** The time of the reading, as {@link monitorTime} prints it. */
  readonly at: string;
}

/**
 * The exit code `wait` reports in `sh` for an ending.
 *
 * @param reading - the exit code or the signal number.
 * @returns the code; `128 + signal` for a signal death; `1` when the reading
 *   holds neither.
 */
export const agentExitCode = (reading: AgentEndReading): number => {
  if (reading.code !== null) return reading.code;
  return reading.signal === null ? 1 : 128 + reading.signal;
};

/**
 * The finding the worker wrapper reports for an agent's exit code.
 *
 * @param code - the agent's exit code, as {@link agentExitCode} reads it.
 * @param agentPid - the agent's pid.
 * @returns `clear` for 0 and `gone` for any other code, with the evidence text.
 */
export const workerEnding = (code: number, agentPid: number): AgentEnding =>
  code === 0
    ? { finding: 'clear', evidence: `the agent pid ${agentPid} exited 0; the worker is finished` }
    : { finding: 'gone', evidence: `the agent pid ${agentPid} exited ${code}; the wrapper that started it is unattended` };

/**
 * A time in the form `date -u +%Y-%m-%dT%H:%M:%SZ` prints.
 *
 * @param epochMs - milliseconds since the epoch.
 * @returns UTC to the second, with a `Z` suffix.
 */
export const monitorTime = (epochMs: number): string => new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The WorkerMonitor line for an ending, in the field order of the monitors'
 * `publish()`: `monitor`, `branch`, `worktree`, `finding`, `since`,
 * `evidence`, `measuredAt`.
 *
 * @param input - the branch, the desk, the ending and the time.
 * @returns one JSON line, newline-terminated.
 */
export const workerEndingLine = (input: EndingLineInput): string =>
  `${JSON.stringify({
    monitor: 'WorkerMonitor',
    branch: input.branch,
    worktree: input.desk,
    finding: input.ending.finding,
    since: input.at,
    evidence: input.ending.evidence,
    measuredAt: input.at,
  })}\n`;
