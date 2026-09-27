import type { PortResult } from '../port-result.js';
import type { SupervisionReport } from '../entities/supervision-report.js';

/**
 * Carries one tick's judgement of every desk from the daemon to the board.
 *
 * **WHY A PORT AT ALL.** `plot-registryd` and the board are separate processes,
 * and until this existed nothing crossed between them: the tick computed a
 * cause per desk and printed it to stdout. The board could not ask for it
 * without calling `supervise()` itself, which would double the per-agent host
 * call the tick already makes — 180 an hour at three agents — and be the same
 * discarded-verdict defect in a second place.
 *
 * **IT IS AN ADAPTER'S PATH, NOT A CONNECTOR'S.** One local file: no account,
 * no credentials, no rate limit. It sits beside `PrIndexStore` and
 * `SliceSpendRecord`, and it resolves its path the same way, from the COMMON git
 * dir — `--show-toplevel` answers the DESK, and `plot-reap.sh` runs `git
 * worktree remove --force` over exactly those.
 *
 * **ONE WRITER, AND THE PORT CANNOT ENFORCE IT.** Only the daemon calls
 * {@link write}; the board calls {@link read} and never the other. The `rename`
 * makes each write atomic, but a second writer would still race the
 * decide-then-write sequence around it, so the rule lives with the callers and
 * is stated here for whoever adds the third.
 *
 * **NOTHING HERE DECIDES.** The port reads and writes. Whether a cause is fresh
 * enough to show is `reportedCause`'s answer, and whether it owes a person is
 * `owesAPerson`'s.
 */
export interface SupervisionReportStore {
  /**
   * Where this checkout's report lives.
   *
   * REPORTS, NEVER DECIDES — `PrIndexStore.location`'s property. It exists so an
   * operator can be told where to look, and so a test can prove that a dispatch
   * desk and the main checkout resolve the same file: the one assertion a test
   * run only in the main checkout cannot make.
   *
   * @returns an absolute path; `failed` where no common git dir resolves.
   */
  location(): Promise<PortResult<string>>;

  /**
   * Reads the last report the daemon wrote.
   *
   * **A MISSING, EMPTY, UNPARSEABLE OR UNRECOGNISED FILE IS `answered(null)`,
   * NOT `failed`.** All four mean *no tick judged anything I can read*, which is
   * the state of every machine where the supervisor has never run. A caller must
   * never read any of them as *the desks are fine*.
   *
   * @returns the report, `null` where there is none to read, or `failed`.
   */
  read(): Promise<PortResult<SupervisionReport | null>>;

  /**
   * Replaces the report with this tick's.
   *
   * **A FAILED WRITE IS A VALUE, NEVER A THROW.** The daemon's job is to
   * supervise; a read-only filesystem must cost the board a field and not cost
   * the fleet its tick.
   *
   * @param report - what this tick decided.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(report: SupervisionReport): Promise<PortResult<void>>;
}
