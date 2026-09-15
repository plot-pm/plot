import type { TokenCountsRecord } from '../entities/slice-spend.js';
import { readSpend, type SpendReadState } from './slice-spend-record.js';

/**
 * What one of a plan's branches contributed to the sum.
 *
 * The state is {@link SpendReadState}'s, unchanged: a branch is `measured`,
 * `absent` or `unreadable`, and the three never collapse into two.
 */
export interface PlanSpendSlice {
  /** The branch, as the plan names it. */
  branch: string;
  /** Whether this branch was measured on this machine. */
  state: SpendReadState;
  /** What it spent on its newest run, or null where it was not measured. */
  tokens: TokenCountsRecord | null;
}

/**
 * What a plan's slices cost, summed over the ones that were measured.
 *
 * **`tokens` IS NULL WHERE NOTHING WAS MEASURED, NEVER A ZEROED RECORD.** A
 * recorded zero is indistinguishable from a free run, and a sum over one is
 * wrong in the direction nobody checks.
 *
 * **`absent` AND `unreadable` ARE TWO COUNTS AND NEVER ONE.** A branch nobody
 * measured here and a record that could not be read are different facts, and
 * collapsing them is the failure this repo has shipped twice.
 */
export interface PlanSpend {
  /**
   * The four counters summed across the `measured` slices, or null.
   *
   * FOUR KEYS AND NO FIFTH. The counters stay apart because cache reads are
   * 99.36% of a naive four-counter total, so a summed fifth field would be a
   * cache-read count wearing a cost's name.
   */
  tokens: TokenCountsRecord | null;
  /** How many of the plan's branches carried a record here. */
  measured: number;
  /** How many were read and hold nothing — another machine, or the bound path. */
  absent: number;
  /** How many could not be read at all. */
  unreadable: number;
  /** Every branch the plan named, in the order it named them. */
  slices: readonly PlanSpendSlice[];
}

/** A zero of every counter — the identity a sum starts from, never an answer. */
const noTokens = (): TokenCountsRecord => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

/**
 * Sums a plan's measured slices, counting the ones that were not.
 *
 * **THE BRANCHES COME FROM THE CALLER, NEVER FROM THE RECORD.** A plan names
 * its branches in `## Slices` and a record naming an unlisted branch is not this
 * plan's cost. One record file holds every branch the machine has measured.
 *
 * **LINES AS VALUES, SO NO TRANSCRIPT CAN BE OPENED.** This takes the record's
 * raw lines and a branch list, and reaches nothing. The write at
 * `seal_declaration` exists so no later reader re-derives, and a pure function
 * is how that is enforced rather than claimed.
 *
 * **THE SUM IS COMPLETE GOING FORWARD AND EMPTY BACKWARD.** A record survives
 * its desk's reap, so the gap is a cold start rather than a property. One
 * absence stays permanent: a worker killed by the `Worker bound` never reaches
 * the write site, so the most expensive runs record nothing and the sum is
 * biased LOW in a direction invisible from the records alone.
 *
 * @param lines - the record's raw lines, in file order; null where the record
 *   itself could not be read, which makes every branch `unreadable`.
 * @param branches - the branches the plan names, in plan order. A branch named
 *   twice is read twice and summed once per naming.
 * @returns the per-counter sums over the measured slices with `tokens` null
 *   where none were, the three counts, and one entry per branch.
 */
export const planSpend = (
  lines: readonly string[] | null,
  branches: readonly string[],
): PlanSpend => {
  const slices: PlanSpendSlice[] = [];
  const total = noTokens();
  let measured = 0;
  let absent = 0;
  let unreadable = 0;

  for (const branch of branches) {
    const read = readSpend(lines, branch);
    const latest = read.state === 'measured' ? read.latest : null;
    slices.push({ branch, state: read.state, tokens: latest?.tokens ?? null });
    if (read.state === 'unreadable') {
      unreadable += 1;
      continue;
    }
    if (latest === null) {
      absent += 1;
      continue;
    }
    measured += 1;
    total.inputTokens += latest.tokens.inputTokens;
    total.outputTokens += latest.tokens.outputTokens;
    total.cacheCreationTokens += latest.tokens.cacheCreationTokens;
    total.cacheReadTokens += latest.tokens.cacheReadTokens;
  }

  // NO TOTAL RATHER THAN A ZERO. `reduce(…, 0)` over nothing is correct
  // arithmetic and a lie: it reports a plan nobody measured as a free one.
  return { tokens: measured === 0 ? null : total, measured, absent, unreadable, slices };
};

/**
 * How a reader is told what a plan's slices cost.
 *
 * **THE COUNTS TRAVEL WITH THE SUM, ALWAYS.** A reader given a bare total cannot
 * tell a cheap plan from a half-recorded one, and on this estate the missing
 * slices are the expensive ones — a desk is reaped when its work lands, so
 * absences correlate with success.
 *
 * @param spend - what {@link planSpend} found.
 * @returns a sentence for a person; never a number where nothing was measured.
 */
export const planSpendSummary = (spend: PlanSpend): string => {
  const { tokens, measured, absent, unreadable, slices } = spend;
  const unmeasured = [
    absent === 0 ? '' : `${absent} not measured here`,
    unreadable === 0 ? '' : `${unreadable} unreadable`,
  ].filter((part) => part !== '');

  if (tokens === null) {
    const why = unmeasured.length === 0 ? 'no slices' : unmeasured.join(', ');
    return `not measured here (${why})`;
  }

  const counts = [
    `in ${tokens.inputTokens}`,
    `out ${tokens.outputTokens}`,
    `cache-write ${tokens.cacheCreationTokens}`,
    `cache-read ${tokens.cacheReadTokens}`,
  ].join(', ');
  const scope = `${measured} of ${slices.length} slices measured`;
  return unmeasured.length === 0
    ? `${counts} over ${scope}`
    : `${counts} over ${scope} — ${unmeasured.join(', ')}`;
};
