import type { PortResult } from '../port-result.js';
import type { EndingActor, EndingReason } from '../entities/ending.js';

/** One record `writeEnding` lands, keyed by the fields `write_ending` carries. */
export interface EndingRecord {
  /** Why the worker ended. */
  reason: EndingReason;
  /** Which party ended it. */
  actor: EndingActor;
  /** The branch it held when it ended; `''` when it held none. */
  branch: string;
  /** One sentence naming the reading. */
  detail: string;
}

/** One finding `publishFinding` appends, in the fields `FindingSchema` requires beside the ones the adapter fills. */
export interface DeskFinding {
  /** The branch the finding is about. */
  branch: string;
  /** The finding word. */
  finding: 'gone' | 'idle' | 'clear';
  /** When the finding first held, ISO-8601. */
  since: string;
  /** One sentence naming the measurement behind the finding. */
  evidence: string;
}

/**
 * Writes the files a desk carries through the loop's lifetime — the ending,
 * the `PLOT-BLOCKED` marker, the declaration, the correction file, the limited
 * record, the moved worker record and the findings lines.
 *
 * **EVERY WRITE IS KEYED BY WORKTREE, NEVER BY SESSION.** A desk is a
 * filesystem location; the files this port writes are read by path from
 * `plot-worker-state.sh`, `plot-reap.sh` and `plot-fleet-scan.sh` alike, and
 * none of them join on a session id to find them.
 *
 * **BEST EFFORT STAYS BEST EFFORT, AND NO FURTHER.** `writeEnding`'s
 * `endings.jsonl` append may fail with no failure of the ending; the ending
 * file itself goes through a temp file and a rename, so a reader never sees a
 * partial record. Carrying one property into the other's write would be a
 * silent change of contract — see `write_ending` (`plot-worker-loop.sh:1319`),
 * whose two halves this mirrors exactly.
 */
export interface Desk {
  /**
   * Writes the worker's ending record and appends its line to the main
   * checkout's `.plot/state/endings.jsonl`.
   *
   * **THE APPEND IS BEST EFFORT; THE FILE WRITE IS NOT.** A missing main
   * checkout, a missing `.plot/state` directory, or a failed append changes
   * neither the ending file's content nor this call's own result — matching
   * `write_ending`'s own comment, *"a missing main checkout... is read as
   * append nothing rather than failing the write it rides beside."* The
   * ending file itself goes through a temp file and a rename, so a reader
   * never sees a partial record.
   *
   * @param worktree - the worktree the loop ends in, absolute.
   * @param record - why it ended, who ended it, and on what branch.
   * @returns nothing; a failure means the ENDING FILE itself could not be
   *   written — never a failed `endings.jsonl` append.
   */
  writeEnding(worktree: string, record: EndingRecord): Promise<PortResult<void>>;

  /**
   * Writes a `PLOT-BLOCKED.md` marker, unless one is already there.
   *
   * **NO-OVERWRITE.** An existing marker is a question already asked; writing
   * over it would answer a question nobody asked. Matches
   * `write_blocked_marker` (`plot-worker-loop.sh:494`) exactly.
   *
   * @param worktree - the worktree the marker lands in, absolute.
   * @param text - the marker's body.
   * @returns nothing; always answers rather than failing, matching the
   *   shell's best-effort write.
   */
  writeBlockedMarker(worktree: string, text: string): Promise<PortResult<void>>;

  /**
   * Writes the declaration for the branch that just finished, MERGING rather
   * than replacing.
   *
   * **THE AGENT MAY SPEAK FIRST.** If the prompt already wrote the file, its
   * `artifacts`, `pr` and `summary` survive; this fills in only `branch` and a
   * `status` of `ok` where none was declared. Matches `seal_declaration`
   * (`plot-worker-loop.sh:1210`), including its refusal: an existing file that
   * does not parse as a plain object is left exactly as it is rather than
   * overwritten, because that file's own contract keeps *unreadable* apart
   * from *absent*.
   *
   * @param worktree - the worktree the declaration lands in, absolute.
   * @param branch - the branch that finished.
   * @returns nothing; a failure means an unparseable file was found and left
   *   alone, or the write itself could not land.
   */
  sealDeclaration(worktree: string, branch: string): Promise<PortResult<void>>;

  /**
   * Appends one correction to `PLOT-CORRECTION.md`, never replacing it.
   *
   * **APPEND, THE OPPOSITE OF {@link writeBlockedMarker}'S GUARD.** The marker
   * protects a question a person must answer; this is the account of what was
   * tried, and a second correction must not erase the first — the budget's
   * whole history stays readable. Matches `write_correction`
   * (`plot-worker-loop.sh:541`).
   *
   * @param worktree - the worktree the correction lands in, absolute.
   * @param branch - the branch the correction is about.
   * @param text - the build gate's verdict, verbatim.
   * @param attempt - this correction's own number.
   * @param budget - the correction budget.
   * @returns nothing; always answers rather than failing, matching the
   *   shell's best-effort write.
   */
  writeCorrection(
    worktree: string,
    branch: string,
    text: string,
    attempt: number,
    budget: number,
  ): Promise<PortResult<void>>;

  /**
   * Records the usage limit a desk is waiting out, OVERWRITING any earlier
   * record.
   *
   * Matches `write_limited_record` (`plot-worker-loop.sh:1370`): a second
   * limit replaces the first rather than joining it, because the file answers
   * *what is this desk waiting for NOW*.
   *
   * @param worktree - the worktree the record lands in, absolute.
   * @param resetEpoch - the reset, as epoch seconds.
   * @param resetIso - the same reset, as UTC ISO text.
   * @param limitLine - the harness's own limit line.
   * @returns nothing; always answers rather than failing.
   */
  writeLimitedRecord(
    worktree: string,
    resetEpoch: number,
    resetIso: string,
    limitLine: string,
  ): Promise<PortResult<void>>;

  /**
   * Removes the limited record — the slice ended, the agent hopped, or the
   * worker is leaving.
   *
   * @param worktree - the worktree to clear, absolute.
   * @returns nothing; always answers, matching `clear_limited_record`.
   */
  clearLimitedRecord(worktree: string): Promise<PortResult<void>>;

  /**
   * Moves a worker's own `.plot-worker.pid` and `.plot-worker.wrapper.pid`
   * records from the desk it left to the desk it took.
   *
   * **THE OLD FILES ARE EMPTIED, NOT DELETED.** `plot-reap.sh` and
   * `plot-reconcile-scan.sh` recognise a dispatch desk by `.plot-worker.pid`,
   * so a deleted file leaves the old desk unplaced and never reaped. Matches
   * `move_worker_record` (`plot-worker-loop.sh:1839`), including its no-op on
   * a same-desk move.
   *
   * @param from - the desk left, absolute.
   * @param to - the desk taken, absolute.
   * @returns nothing; always answers, matching the shell's best-effort move.
   */
  moveWorkerRecord(from: string, to: string): Promise<PortResult<void>>;

  /**
   * Appends one `WorkerMonitor` finding line to the desk's
   * `.plot-worker.monitor.worker.jsonl`, the file the shell loop writes and
   * the board reads. The line carries every field `FindingSchema` requires:
   * `monitor` is `WorkerMonitor`, `worktree` is the desk, and `measuredAt` is
   * the moment of the write.
   *
   * @param worktree - the worktree the finding is about, absolute.
   * @param finding - the branch, finding word, `since` and evidence.
   * @returns nothing; always answers rather than failing.
   */
  publishFinding(worktree: string, finding: DeskFinding): Promise<PortResult<void>>;
}
