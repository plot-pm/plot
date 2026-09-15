import type { SliceSpend } from '../entities/slice-spend.js';
import type { SliceSpendRecord } from '../ports/slice-spend.js';
import { planSpend, type PlanSpend } from '../rules/plan-spend.js';
import { tokensForBranch } from '../rules/slice-tokens.js';
import { readSpend, type SpendRead } from '../rules/slice-spend-record.js';

/**
 * Why a slice's spend was not recorded.
 *
 * **EVERY ONE OF THESE RECORDS NOTHING RATHER THAN A ZERO**, which is the
 * failure the whole plan is built to avoid: a recorded zero is
 * indistinguishable from a free run, and a sum over one is wrong in the
 * direction nobody checks.
 *
 * - `no-branch` — the caller named no branch. A record is ABOUT a branch, so
 *   one naming none cannot be attributed, the same refusal `seal_declaration`
 *   makes.
 * - `transcripts-unreadable` — the desk's transcript directory could not be
 *   read. Distinct from finding nothing in it.
 * - `no-turns` — the transcripts were read and this branch contributed no
 *   recognised turn. The honest absence.
 * - `write-failed` — the record could not be appended.
 */
export type SpendWriteRefusal =
  | 'no-branch'
  | 'transcripts-unreadable'
  | 'no-turns'
  | 'write-failed';

/** What {@link recordSliceSpend} did. */
export type SpendWriteOutcome =
  | { ok: true; record: SliceSpend }
  | { ok: false; refusal: SpendWriteRefusal };

/**
 * Sums a desk's transcripts for one branch and appends the record.
 *
 * **CALLED AT `seal_declaration`, WHICH IS THE ONLY MOMENT THAT KNOWS WHICH
 * BRANCH JUST FINISHED.** It runs before `--next` is asked and before any hop
 * moves `$PLOT_BRANCH`. A worker does not exit between slices — it seals,
 * clears the manifest branch, blocks in `wait_for_work`, resets the desk and
 * loops — so a sum taken at worker exit would charge every slice the worker
 * ever held to whichever branch it held last. Of the 12 largest worker
 * transcripts, 3 already span two branches.
 *
 * **COST IS NOT THE ARGUMENT FOR WRITING ONCE.** Measured over 1,966 worker
 * transcripts: largest 7.7 MiB, median 6.9 KiB, and a full four-counter sum
 * over the largest takes 90–250 ms. A cheap scan at the right moment beats an
 * expensive one at the wrong moment.
 *
 * **THE BOUND PATH RECORDS NOTHING, AND THAT IS A STATED GAP.**
 * `seal_declaration` runs on exactly one path — `run_bounded` returned 0 — so a
 * worker killed by the `Worker bound` or ended by the WorkerMonitor never
 * reaches this. For a declaration that absence is load-bearing; for a spend it
 * inverts, because a worker that burned the full bound is the most expensive
 * run there is. **A rollup over these records is therefore biased LOW in a
 * direction nobody can see from the records alone**, and a reader must be told
 * so. It is not fixed here: a write on the bound path is a second write site
 * with its own failure modes.
 *
 * @param record - the port that reads transcripts and keeps the record.
 * @param input - the desk that finished, the branch it held, and the time.
 * @returns the record written, or why nothing was.
 */
export const recordSliceSpend = async (
  record: SliceSpendRecord,
  input: { worktree: string; branch: string; at: string },
): Promise<SpendWriteOutcome> => {
  if (input.branch === '' || input.worktree === '') return { ok: false, refusal: 'no-branch' };

  const sessions = await record.sessions(input.worktree);
  // READ THE EXIT CODE, NOT THE EMPTINESS. An unreadable directory and an empty
  // one are different answers, and only one of them says the run was free.
  if (!sessions.ok) return { ok: false, refusal: 'transcripts-unreadable' };

  const totals = tokensForBranch(sessions.value, input.branch);
  if (totals === null) return { ok: false, refusal: 'no-turns' };

  const written: SliceSpend = {
    branch: totals.branch,
    at: input.at,
    tokens: totals.tokens,
    turns: totals.turns,
    models: [...totals.models],
  };
  const appended = await record.append(written);
  if (!appended.ok) return { ok: false, refusal: 'write-failed' };
  return { ok: true, record: written };
};

/**
 * Reads back what one branch spent, without re-deriving it.
 *
 * **THE RECORD IS WHAT EVERY LATER READER CONSULTS, AND NO REFRESH PATH OPENS A
 * `.jsonl`.** The board re-deriving per refresh would pass every correctness
 * test and reintroduce the cost the record exists to remove — a test pins that
 * this path opens no transcript.
 *
 * @param record - the port that keeps the record.
 * @param branch - the branch to ask about.
 * @returns the state, the newest record, and the history.
 */
export const readSliceSpend = async (
  record: SliceSpendRecord,
  branch: string,
): Promise<SpendRead> => {
  const lines = await record.lines();
  return readSpend(lines.ok ? lines.value : null, branch);
};

/**
 * Reads what a plan's slices cost, summed over the ones measured here.
 *
 * **THE RECORD IS READ ONCE, NOT ONCE PER SLICE.** One file holds every branch
 * the machine has measured, so composing this as N calls to
 * {@link readSliceSpend} would re-read the whole file N times. The port hands
 * back every line and {@link planSpend} partitions them.
 *
 * **IT OPENS NO TRANSCRIPT AND WRITES NOTHING.** A rollup is a read, and the
 * sum lives in a pure function that has no port to reach one with.
 *
 * @param record - the port that keeps the record.
 * @param branches - the branches the plan names, in plan order.
 * @returns the per-counter sums with `tokens` null where nothing was measured,
 *   the `absent` and `unreadable` counts, and one entry per branch.
 */
export const readPlanSpend = async (
  record: SliceSpendRecord,
  branches: readonly string[],
): Promise<PlanSpend> => {
  const lines = await record.lines();
  return planSpend(lines.ok ? lines.value : null, branches);
};
