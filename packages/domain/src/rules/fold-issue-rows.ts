import type { IssueIndexRow } from '../entities/issue-index.js';

/**
 * Whether `incoming` should replace `held` for the same key.
 *
 * A row with an `updatedAt` beats one with none. Between two rows that both
 * have one, the newer timestamp wins. Where neither has one, or the two are
 * equal, `incoming` wins — the fold is a replace-on-tie, not a keep-on-tie.
 *
 * @param held - the row already folded in for this key.
 * @param incoming - the row being folded in for the same key.
 * @returns true where `incoming` should replace `held`.
 */
const replaces = (held: IssueIndexRow, incoming: IssueIndexRow): boolean => {
  if (incoming.updatedAt === undefined) return held.updatedAt === undefined;
  if (held.updatedAt === undefined) return true;
  return incoming.updatedAt >= held.updatedAt;
};

/**
 * Folds two sets of issue rows by `number`, keeping the newer of any two
 * readings of the same key.
 *
 * Neither input is mutated. The result holds one row per key that appears in
 * either input, in the order each key was first seen across `held` then
 * `incoming`.
 *
 * @param held - the rows already in the index.
 * @param incoming - the rows a fresh read answered.
 * @returns the folded rows.
 */
export const foldIssueRows = (
  held: readonly IssueIndexRow[],
  incoming: readonly IssueIndexRow[],
): IssueIndexRow[] => {
  const byKey = new Map<string, IssueIndexRow>();
  const order: string[] = [];
  for (const row of held) {
    byKey.set(row.number, row);
    order.push(row.number);
  }
  for (const row of incoming) {
    const current = byKey.get(row.number);
    if (current === undefined || replaces(current, row)) byKey.set(row.number, row);
    if (!order.includes(row.number)) order.push(row.number);
  }
  return order.map((key) => byKey.get(key)!);
};

/** The open and closed rows a changed-since read leaves. */
export interface ChangedIssueFold {
  /** The open rows. */
  rows: IssueIndexRow[];
  /** The closed rows of the window that starts at `closedSince`. */
  closedRows: IssueIndexRow[];
}

/**
 * Folds the rows of one changed-since read into the held open and closed sets.
 *
 * - A changed row with `statusCategory` `Done` leaves the open set. It joins
 *   the closed set only where its `closedAt` parses and is at or after
 *   `closedSince`; a row closed earlier, or with no readable `closedAt`, joins
 *   neither set.
 * - Any other changed row is folded into the open set through
 *   {@link foldIssueRows} and leaves the closed set.
 *
 * @param open - the held open rows.
 * @param closed - the held closed rows.
 * @param closedSince - the start of the closed set's window, ISO-8601.
 * @param changed - the rows the changed read answered.
 * @returns the open rows and the closed rows.
 */
export const foldChangedIssueRows = (
  open: readonly IssueIndexRow[],
  closed: readonly IssueIndexRow[],
  closedSince: string,
  changed: readonly IssueIndexRow[],
): ChangedIssueFold => {
  const done = changed.filter((row) => row.statusCategory === 'Done');
  const notDone = changed.filter((row) => row.statusCategory !== 'Done');
  const doneKeys = new Set(done.map((row) => row.number));
  const openKeys = new Set(notDone.map((row) => row.number));
  const floor = Date.parse(closedSince);
  const inWindow = done.filter((row) => row.closedAt !== undefined && Date.parse(row.closedAt) >= floor);
  return {
    rows: foldIssueRows(open, notDone).filter((row) => !doneKeys.has(row.number)),
    closedRows: foldIssueRows(closed, inWindow).filter((row) => !openKeys.has(row.number)),
  };
};
