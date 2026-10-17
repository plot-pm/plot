import type { IssueIndex, IssueIndexRow } from '../entities/issue-index.js';
import type { IssueWrite } from '../entities/issue-write.js';
import { foldIssueRows } from './fold-issue-rows.js';

/** The `statusCategory` word that closes an issue, as {@link foldChangedIssueRows} reads it. */
const CLOSED = 'Done';

/**
 * The row a write leaves for its issue, or null where the write names too
 * little to make one.
 *
 * A row already held for the issue is the base, and the write's own fields
 * replace it. A status that changes without a stated category drops the held
 * category, because the held word would describe the old status. A write with
 * no `updatedAt` keeps the held row's, so it ties with the held row and wins
 * the fold; a read of the tracker carries a later `updatedAt` and replaces it.
 * Without a held row, a write that carries a title makes a new row.
 */
const rowOf = (write: IssueWrite, held: IssueIndexRow | undefined): IssueIndexRow | null => {
  if (held === undefined) {
    if (write.title === undefined) return null;
    return {
      number: write.number,
      title: write.title,
      url: write.url ?? '',
      ...(write.updatedAt === undefined ? {} : { updatedAt: write.updatedAt }),
      ...(write.status === undefined ? {} : { status: write.status }),
      ...(write.statusCategory === undefined ? {} : { statusCategory: write.statusCategory }),
    };
  }
  const category = write.statusCategory ?? (write.status === undefined ? held.statusCategory : undefined);
  const row: IssueIndexRow = {
    ...held,
    ...(write.title === undefined ? {} : { title: write.title }),
    ...(write.url === undefined ? {} : { url: write.url }),
    ...(write.status === undefined ? {} : { status: write.status }),
    ...(write.updatedAt === undefined ? {} : { updatedAt: write.updatedAt }),
  };
  if (category === undefined) delete row.statusCategory;
  else row.statusCategory = category;
  return row;
};

/**
 * Folds the writes Plot made to the tracker into the held issue index.
 *
 * - No held index returns null: a write-through never creates an index, since
 *   a created one would read as `answered` and skip the full read.
 * - A write for another connector or account is ignored: it spent none of
 *   this index's budget and says nothing about its rows.
 * - Each write for this connector and account adds 1 to `requests`, whether
 *   or not its row is folded.
 * - A row folds by `number` through {@link foldIssueRows}, so a row with an
 *   older `updatedAt` than the held one does not replace it. A row with
 *   `statusCategory` `Done` leaves `rows` and joins `closed.rows`; any other
 *   row leaves `closed.rows` and joins `rows`. Where no `closed` set was
 *   read, a closed row only leaves `rows`.
 * - `at`, `nextAt`, `backoffUntil`, `answer`, `fullReadAt` and
 *   `passesSinceFull` stay as held: a write is not a read of the tracker.
 *
 * @param held - the index on disk, or null.
 * @param writes - the writes in the order they were made.
 * @returns the index to write, or null where there is nothing to write.
 */
export const issueWriteThrough = (
  held: IssueIndex | null,
  writes: readonly IssueWrite[],
): IssueIndex | null => {
  if (held === null) return null;
  const mine = writes.filter(
    (write) => write.connector === held.connector && (write.account ?? null) === (held.account ?? null),
  );
  if (mine.length === 0) return null;
  let rows = held.rows;
  let closedRows = held.closed?.rows;
  for (const write of mine) {
    if (rows === undefined) continue;
    const current = rows.find((row) => row.number === write.number);
    const closedCurrent = closedRows?.find((row) => row.number === write.number);
    const base = current ?? closedCurrent;
    const next = rowOf(write, base);
    if (next === null) continue;
    if (base !== undefined && foldIssueRows([base], [next])[0] !== next) continue;
    const without = (list: readonly IssueIndexRow[]): IssueIndexRow[] =>
      list.filter((row) => row.number !== write.number);
    if (next.statusCategory === CLOSED) {
      rows = without(rows);
      if (closedRows !== undefined) closedRows = foldIssueRows(closedRows, [next]);
    } else {
      rows = foldIssueRows(rows, [next]);
      if (closedRows !== undefined) closedRows = without(closedRows);
    }
  }
  return {
    ...held,
    requests: held.requests + mine.length,
    ...(rows === undefined ? {} : { rows }),
    ...(held.closed === undefined ? {} : { closed: { ...held.closed, ...(closedRows === undefined ? {} : { rows: closedRows }) } }),
  };
};
