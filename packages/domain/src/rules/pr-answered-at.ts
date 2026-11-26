import type { PrAnswerKind } from './pr-index.js';

/**
 * When the PR data a board serves from a snapshot was last answered by the host.
 *
 * The snapshot's `prs` reading keeps its `readAt` while the rows are unchanged,
 * so it names when the rows last changed. The reader state's `prAt` names when
 * the reader's last read answered.
 *
 * @param readAt - the `readAt` of the snapshot's `read` `prs` reading, epoch ms.
 * @param answeredAt - the reader state's `prAt`, epoch ms; null or undefined
 *   where the reader published none.
 * @returns `answeredAt` where it is later than `readAt`, otherwise `readAt`.
 */
export const prAnsweredAt = (readAt: number, answeredAt: number | null | undefined): number =>
  typeof answeredAt === 'number' && answeredAt > readAt ? answeredAt : readAt;

/**
 * Whether a PR pass the host answered moves the reader's `prAt`.
 *
 * A delta answers only the rows that changed, and its rows reach the snapshot
 * only through the fold. A delta with no fold records no reading, so the
 * snapshot keeps its older rows; a newer `prAt` would make the board's PR age
 * younger than those rows.
 *
 * @param kind - the kind of answer the pass received.
 * @param folded - whether the pass folded its answer into the store.
 * @returns false for a delta with no fold, otherwise true.
 */
export const answerMovesPrAt = (kind: PrAnswerKind, folded: boolean): boolean => kind !== 'delta' || folded;
