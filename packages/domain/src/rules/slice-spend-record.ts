import { decodeSliceSpend, type SliceSpend } from '../entities/slice-spend.js';

/**
 * What one read of the record found for one branch.
 *
 * **`measured` IS A WORD, NOT A BOOLEAN, AND THAT IS THE WHOLE POINT.** A
 * reader on a machine holding no record must be told *not measured here* rather
 * than shown a zero: a recorded zero is indistinguishable from a free run, and
 * a sum over one is wrong in the direction nobody checks.
 *
 * - `measured` — a record was found; `latest` carries it.
 * - `absent` — the record was read and holds nothing for this branch. The run
 *   may have taken the bound path, may have run on another machine, or may
 *   never have started.
 * - `unreadable` — the record itself could not be read. Distinct from `absent`
 *   for the reason `plot-worker-state.sh` keeps them apart: a failed call and
 *   an empty result are different answers.
 */
export type SpendReadState = 'measured' | 'absent' | 'unreadable';

/**
 * What a reader learns about one branch's spend.
 *
 * ONE ANSWER RATHER THAN THREE CALLS, the shape `spendRate` takes in
 * `budget-record.ts`: every caller wants the state AND the newest record AND
 * the history, and a caller composing them itself composes them differently.
 */
export interface SpendRead {
  /** Whether this branch was measured here at all. */
  state: SpendReadState;
  /**
   * The newest record for the branch, or null.
   *
   * THE NEWEST, NOT THE ONLY. A second run writes a second record rather than
   * mutating the first, so a branch re-dispatched after a correction carries
   * several — and the newest is what the branch cost on its last run.
   */
  latest: SliceSpend | null;
  /** Every record for the branch, in file order — oldest first. */
  history: readonly SliceSpend[];
  /** How many lines could not be read at all — torn tails, newer formats. */
  unreadable: number;
}

/**
 * Reads one branch's spend out of the record's raw lines.
 *
 * **LINES AS VALUES, NEVER A PATH.** The domain does not touch the disk: the
 * adapter decides what it read and this decides what it means, which is the
 * same contract `readWindow` takes in `budget-record.ts`.
 *
 * **A LINE BELONGING TO ANOTHER BRANCH IS NOT THIS BRANCH'S BUSINESS** and is
 * neither returned nor counted unreadable. One file holds every branch the
 * machine has measured.
 *
 * @param lines - the record's raw lines, in file order; null where the record
 *   itself could not be read.
 * @param branch - the branch to ask about.
 * @returns the state, the newest record, the history, and how many lines were
 *   unreadable.
 */
export const readSpend = (lines: readonly string[] | null, branch: string): SpendRead => {
  if (lines === null) {
    return { state: 'unreadable', latest: null, history: [], unreadable: 0 };
  }
  const history: SliceSpend[] = [];
  let unreadable = 0;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const record = decodeSliceSpend(line);
    if (record === null) {
      unreadable += 1;
      continue;
    }
    if (record.branch === branch) history.push(record);
  }
  return {
    state: history.length === 0 ? 'absent' : 'measured',
    latest: history.length === 0 ? null : (history[history.length - 1] ?? null),
    history,
    unreadable,
  };
};

/**
 * How a reader is told what the record holds for a branch.
 *
 * **THE ABSENT CASES NAME THEMSELVES AND NEVER RENDER A NUMBER.** This is the
 * sentence that keeps *no record here* apart from *a free run* at the point a
 * person reads it — the honesty the plan calls the deliverable.
 *
 * @param read - what {@link readSpend} found.
 * @returns a sentence for a person.
 */
export const spendSummary = (read: SpendRead): string => {
  if (read.state === 'unreadable') return 'spend record unreadable';
  if (read.state === 'absent' || read.latest === null) return 'not measured here';
  const { tokens, models, turns } = read.latest;
  const counts = [
    `in ${tokens.inputTokens}`,
    `out ${tokens.outputTokens}`,
    `cache-write ${tokens.cacheCreationTokens}`,
    `cache-read ${tokens.cacheReadTokens}`,
  ].join(', ');
  const on = models.length === 0 ? 'model unrecorded' : models.join(', ');
  return `${counts} over ${turns} turns on ${on}`;
};
