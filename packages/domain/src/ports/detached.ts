/** A process started apart from the caller, which outlives it. */
export interface DetachedProcess {
  /** The pid the process runs under. */
  pid: number;
  /** The exit code once the process has exited; `null` while it lives. */
  exitCode: () => number | null;
}

/** Starts a Node script as a process that outlives its caller. */
export interface Detached {
  /**
   * Runs `node <script> <args>` in its own session, with stdout and stderr
   * written to `logFile` (truncated).
   *
   * @param script - absolute path of the script.
   * @param args - the script's arguments.
   * @param cwd - the directory the process runs in.
   * @param logFile - where the process's output goes.
   * @returns the started process.
   */
  node(script: string, args: readonly string[], cwd: string, logFile: string): DetachedProcess;
}
