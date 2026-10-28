import type { PortResult } from '../port-result.js';

/**
 * Pins a branch's tip before `plot-reap` deletes it, so the delete is
 * recoverable: `refs/plot/reaped/<branch>/<sha>` keeps the commit reachable,
 * and `.plot/state/reaped.tsv` records when it was pinned, under the common
 * git dir so a desk and the main checkout share one record.
 *
 * **A LOG, NOT A SET.** The same branch reaped twice at two different tips
 * gets two rows and two refs — unlike {@link RefusedSliceRecord}, which the
 * TSV placement otherwise mirrors.
 *
 * **NO PIN, NO DELETE.** `pin` fails the whole operation rather than the ref
 * write alone where the TSV append does not also land, so a caller never
 * deletes a branch whose tip looks pinned but is not recorded for pruning.
 */
export interface PinnedTips {
  /**
   * Writes `refs/plot/reaped/<branch>/<sha>` and appends a row to
   * `.plot/state/reaped.tsv`.
   *
   * A second pin of the same branch at the same sha writes the same ref
   * again and still appends a row — repeating the ref write is harmless, and
   * the row is what age is read from.
   *
   * @param branch - the branch about to be deleted.
   * @param sha - its tip, resolved before the delete.
   * @returns the ref that now holds the tip; `failed()` where the ref write
   *   or the row append did not land. Never throws.
   */
  pin(branch: string, sha: string): Promise<PortResult<string>>;

  /**
   * Deletes every pinned ref whose row is older than `maxAgeMs`, and removes
   * those rows.
   *
   * A ref with no row is never touched — unknown age keeps it. A row whose
   * ref is already gone just has its row removed.
   *
   * @param maxAgeMs - how old a row must be to prune; the plan's number is
   *   30 days.
   * @param now - the clock to measure age against.
   * @returns the refs removed; `failed()` where the TSV could not be read
   *   or rewritten. A ref delete failing for one row does not stop the rest.
   */
  prune(maxAgeMs: number, now: Date): Promise<PortResult<readonly string[]>>;
}
