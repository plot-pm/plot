import { supervisionReportFile } from '@plot-pm/domain/adapters';
import type { SupervisionCause } from '@plot-pm/domain/rules/supervision';
import type { SupervisionReportStore } from '@plot-pm/domain/ports/supervision-report';
import type { BuildBoardOptions } from './board.js';

/**
 * WHAT THE SUPERVISOR DECIDED, READ ON THE REFRESH'S CLOCK.
 *
 * One local file read per pulse — no host call, no network, no subprocess after
 * the first. It sits beside `supervisor-reading.ts`, which answers whether the
 * daemon is loaded at all; this answers what its last tick decided about each
 * desk.
 *
 * ## The channel, and why there is one
 *
 * `plot-registryd` and the board are separate processes. The tick computes a
 * {@link SupervisionCause} for every desk and, before this, printed it to stdout
 * and discarded it — so `/api/fleet` carried no cause field at all and an
 * operator could not tell a desk the fleet was about to serve from one it had
 * given up on. The daemon now writes a per-tick report and this reads it.
 *
 * ## No second computation
 *
 * **THE BOARD MUST NOT CALL `supervise()` OR `tick()`.** That is the defect this
 * fixes, reproduced: the per-agent host call the tick already makes is 180 an
 * hour at three agents, and a board repeating it on its own refresh would double
 * that to answer a question already answered. The cause is FORWARDED — the rule
 * `quietKind` states for itself — and this module reads a file and nothing else.
 *
 * ## Absent is not false
 *
 * A missing report, an unparseable one, a report whose write failed, and a
 * report naming other desks all produce `null` for a branch. **None of them
 * produces a cause, and `null` is not `worker-alive`.** A board that defaulted
 * to *fine* would report a healthy desk it never measured — the direction nobody
 * notices, which is how this defect survived in the first place.
 *
 * ## Staleness is the reader's problem, and it is answered in the domain
 *
 * `fleet.ts` refuses to present a recorded answer as a current one. The record
 * carries the tick's own clock, and `reportedCause` drops a cause past
 * `FLEET_TICK_STALE_SECONDS`. That rule is a domain property so it can be
 * asserted without a board: this module supplies the reading, never the verdict.
 */

/** What one refresh read of the daemon's report. */
export interface SupervisionReportReadings {
  /**
   * When the tick that wrote the report started, epoch milliseconds, or null
   * where no report was read.
   *
   * CARRIED SEPARATELY FROM THE CAUSES so a reader can age the whole report
   * once. Every row shares one clock, because one tick wrote them all.
   */
  at: number | null;
  /**
   * The cause the tick reported, by branch.
   *
   * A `Map` rather than a list, because the join is per row and the report holds
   * one entry per desk. A branch the report does not name is absent from it, and
   * absence is the answer.
   */
  causes: ReadonlyMap<string, SupervisionCause>;
}

/** What a refresh that read nothing reports: no clock, no causes. */
export const NO_SUPERVISION_REPORT: SupervisionReportReadings = {
  at: null,
  causes: new Map(),
};

/**
 * Reads the daemon's last report, or reports that it read nothing.
 *
 * A THROW IS THE SAME FACT AS A FAILED READ: no desk was judged that this board
 * can see. It is caught rather than propagated because this runs inside the
 * refresh's success path, and a probe that could not read a file must not take
 * the whole refresh with it — the rule `readSupervisor` already follows.
 *
 * **THE CAUSE IS CARRIED AS THE FILE SPELLED IT.** The report stores `cause` as
 * a string, since a file written by another Plot version may hold a word this
 * one does not know. Narrowing happens here, by test against the known set: an
 * unrecognised word is dropped rather than cast, so a newer daemon's tenth cause
 * reads as *not judged* instead of reaching the renderer as a word it cannot
 * describe.
 *
 * @param opts - where the repository is.
 * @param store - the store to read; this repository's by default.
 * @returns the report's clock and its causes by branch, or the unread reading.
 */
export async function readSupervisionReport(
  opts: BuildBoardOptions,
  store: SupervisionReportStore = supervisionReportFile({ cwd: opts.repoRoot }),
): Promise<SupervisionReportReadings> {
  try {
    const result = await store.read();
    if (!result.ok || result.value === null) return NO_SUPERVISION_REPORT;
    const causes = new Map<string, SupervisionCause>();
    for (const row of result.value.rows) {
      // A ROW NAMING NO BRANCH IS DROPPED, NOT KEYED ON `''`. A FREE agent holds
      // no slice, so the tick judges it with an empty branch — measured
      // 2026-09-27, a tick over 8 agents wrote 2 such rows. The join is by
      // branch, so an empty key can match no row, and storing one would put a
      // cause in the map under a name nothing asks for.
      //
      // IT IS DROPPED HERE AND NOT BY THE SCHEMA. A strict `min(1)` made the
      // WHOLE file unparseable and cost all 8 desks their cause, because the
      // reader's fallback for a file it cannot parse is to carry nothing.
      if (row.branch === '') continue;
      const cause = knownCause(row.cause);
      if (cause !== null) causes.set(row.branch, cause);
    }
    return { at: result.value.at, causes };
  } catch {
    return NO_SUPERVISION_REPORT;
  }
}

/**
 * The nine causes, as the words a report may carry.
 *
 * A SET RATHER THAN A CAST. The report is a file, and a file can hold anything —
 * an older format, a newer daemon's tenth cause, a hand-edited line. Casting the
 * string would put an undescribable word on a row; testing it means an
 * unrecognised one is simply not a cause.
 */
const CAUSES: ReadonlySet<string> = new Set<SupervisionCause>([
  'worker-alive',
  'gates-passed',
  'gates-failed',
  'declaration-absent',
  'declaration-unreadable',
  'agent-blocked',
  'budget-spent',
  'no-progress',
  'no-headroom',
]);

/**
 * Narrows a report's word to a cause, or nothing.
 *
 * @param word - the `cause` as the file spelled it.
 * @returns the cause, or null where this Plot does not know the word.
 */
const knownCause = (word: string): SupervisionCause | null =>
  CAUSES.has(word) ? (word as SupervisionCause) : null;
