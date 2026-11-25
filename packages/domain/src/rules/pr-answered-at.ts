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
