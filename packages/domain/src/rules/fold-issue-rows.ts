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
