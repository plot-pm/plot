/**
 * How old the last successful fetch of the plan ref is, in whole seconds.
 *
 * @param fetchedAt - epoch milliseconds of the last fetch that succeeded, or
 *   null where none has succeeded yet.
 * @param nowMs - the current time, epoch milliseconds.
 * @returns whole seconds since the fetch, null for a null `fetchedAt`, never
 *   negative.
 */
export const serverPlanRefAgeSeconds = (fetchedAt: number | null, nowMs: number): number | null => {
  if (fetchedAt === null) return null;
  return Math.max(0, Math.floor((nowMs - fetchedAt) / 1_000));
};

/**
 * How old the plan ref reads on the page right now — the server's age at the
 * time the page received it, plus the whole seconds that have elapsed on the
 * page's own clock since.
 *
 * Takes the server age as a value rather than a timestamp to subtract from
 * `nowMs`: the page's clock and the server's clock can disagree, so the only
 * number this adds to is one the page itself has been counting since it
 * received the answer.
 *
 * @param serverAgeSeconds - the age the server reported, or null/undefined
 *   where it reported none.
 * @param receivedAtMs - the page's own clock when it received that answer.
 * @param nowMs - the page's own clock now.
 * @returns whole seconds, null for a null or undefined `serverAgeSeconds`,
 *   never negative.
 */
export const pagePlanRefAgeSeconds = (
  serverAgeSeconds: number | null | undefined,
  receivedAtMs: number,
  nowMs: number,
): number | null => {
  if (serverAgeSeconds === null || serverAgeSeconds === undefined) return null;
  const elapsed = Math.max(0, Math.floor((nowMs - receivedAtMs) / 1_000));
  return serverAgeSeconds + elapsed;
};
