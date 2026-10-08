import type { PrIndex, PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { isTerminalRow, mergedRowByHead } from '@plot-pm/domain/rules/merged-row';

/**
 * What one query asks the store about a branch of a plan.
 *
 * Exactly the two resolutions `plot-impl-status.sh` already performs: a plan
 * that annotated its branch names the PR NUMBER, and one that did not is
 * resolved by matching the BRANCH against the heads of merged PRs.
 */
export interface PrIndexQuery {
  /** The PR number the plan annotated, or null where it annotated none. */
  number: number | null;
  /** The branch to match against heads, or null where the number is given. */
  branch: string | null;
}

/**
 * The word that tells the shell to ask the host.
 *
 * **NOT A STATE, AND NEVER AN ABSENT PR.** Three situations produce it — no
 * store, no row for this query, and a row whose state could still change — and
 * every one means *this store cannot answer*, which is a different fact from
 * *the host says there is no PR*. Collapsing them is the failure a delivery
 * gate turns into a refusal: measured 2026-08-27, four fully-merged plans were
 * refused delivery because an empty result read as "not merged".
 */
export const ASK = 'ask';

/** The absent marker, for a field this answer does not carry. */
const NONE = '-';

/**
 * The row for a PR number, or undefined where the store holds none.
 *
 * @param held - the store, already read.
 * @param number - the PR number the plan annotated.
 * @returns the row, or undefined.
 */
const rowByNumber = (held: PrIndex, number: number): PrIndexRow | undefined =>
  held.rows.find((row) => row.number === number);


/**
 * One answer line: the row's fields, or `ask`.
 *
 * **`mergeCommit` IS NOT EMITTED, BECAUSE THE ROW DOES NOT CARRY IT.** The
 * host's `pr-state` answers it and the shell passes that JSON through, so a
 * store-resolved branch carries one field fewer. Every reader of
 * `plot-impl-status.sh` was surveyed on 2026-09-26 and none reads it —
 * `/plot-deliver` reads `number`, `state`, `branch` and `repo`, and
 * `/plot-release` reads `mergeCommit` from `pr-state` DIRECTLY
 * (`skills/plot-release/SKILL.md:381`), never from here. Emitting an empty
 * string would be this machine inventing an answer the host never gave, which
 * is the one thing the store's own entity refuses to do.
 *
 * @param row - the row to render, or undefined to ask.
 * @returns `<number>\t<state>\t<draft>\t<url>\t<head>`, or the ask line.
 */
const lineFor = (row: PrIndexRow | undefined): string => {
  if (row === undefined || !isTerminalRow(row)) {
    return `${NONE}\t${ASK}\t${NONE}\t${NONE}\t${NONE}\n`;
  }
  // The url may be `''` where the host's CLI predates it, and that absence
  // travels as the absent marker rather than as an empty field: a run of tabs
  // collapses into one separator under bash's `read`, so an empty middle column
  // would shift every field after it.
  const url = row.url === '' ? NONE : row.url;
  const head = row.head === '' ? NONE : row.head;
  return `${row.number}\t${row.state.toUpperCase()}\t${row.draft}\t${url}\t${head}\n`;
};

/**
 * Answer every query from the store, or say `ask`.
 *
 * **A NULL STORE ANSWERS `ask` FOR EVERYTHING, AND THAT IS THE COMMON CASE ON A
 * MACHINE WITH NO BOARD.** The only writer is a running board, so a checkout
 * that has never run one has no store at all — and `plot-impl-status.sh` runs
 * inside `/plot-deliver` on exactly those machines. The host fallback is not a
 * degraded path here; it is the path, and the store only ever removes calls
 * from it.
 *
 * **A ROW MISSING FROM AN INCOMPLETE STORE IS NOT PROOF THAT NO PR EXISTS.**
 * `complete: false` means some state did not answer, so rows exist the store
 * has never seen — the `complete` latch in `rules/pr-index.ts` is recorded for
 * exactly this reader. It costs nothing to honour, because a missing row
 * answers `ask` whether the store is whole or not: absence is never an answer
 * here, only ever a reason to ask.
 *
 * @param held - the store as it was read, or null where there is none.
 * @param queries - one per branch of the plan, in the caller's order.
 * @returns one answer line per query, in the same order, newline-terminated.
 */
export const answerLookups = (
  held: PrIndex | null,
  queries: readonly PrIndexQuery[],
): string => {
  if (held === null) return queries.map(() => lineFor(undefined)).join('');
  return queries
    .map((query) => {
      if (query.number !== null) return lineFor(rowByNumber(held, query.number));
      if (query.branch !== null) return lineFor(mergedRowByHead(held, query.branch));
      // A query naming neither is not a resolution the shell can make either.
      return lineFor(undefined);
    })
    .join('');
};
