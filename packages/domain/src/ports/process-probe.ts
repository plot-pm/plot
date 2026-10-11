/** What this process knows about itself, read without a subprocess. */
export interface OwnProcess {
  /** This process's pid. */
  pid: number;
  /** When this process started, epoch milliseconds. */
  startedAt: number;
  /** Whether this process leads its own process group. */
  leadsGroup: boolean;
}

/**
 * Asks the process table about one process or one process group, synchronously.
 *
 * Synchronous because its caller decides inside a synchronous start: a lock is
 * read and taken before the route answers. Each answer costs at most one `ps`.
 */
export interface ProcessProbe {
  /**
   * Whether a process holds the pid.
   *
   * @param pid - the process id to test.
   * @returns `true` where a process holds it, `false` where none does or the pid
   *   is not a positive integer, `null` where the table could not be asked.
   */
  alive(pid: number): boolean | null;

  /**
   * Whether any process belongs to the process group.
   *
   * @param pgid - the process group id; below 2 answers `false`.
   * @returns `true` where a member exists, `false` where none does, `null`
   *   where the table could not be asked.
   */
  groupAlive(pgid: number): boolean | null;

  /**
   * When the process holding the pid started.
   *
   * @param pid - the process id to ask about.
   * @returns epoch milliseconds, read to the second; `null` where no process
   *   holds the pid or its start time cannot be read.
   */
  startedAt(pid: number): number | null;

  /**
   * This process's pid, start time and group leadership.
   *
   * @returns the reading.
   */
  self(): OwnProcess;
}
