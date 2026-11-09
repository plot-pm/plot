/**
 * Whether a desk holds nothing outstanding: no uncommitted path that counts as
 * work and no commit ahead of its upstream.
 *
 * @param dirty - the paths `deskDirtFilter`
 *   keeps for the desk, or `null` where the desk cannot be read.
 * @param unpushed - the commits ahead of the upstream, or `null` where git
 *   cannot count them (no upstream, not a repository).
 * @returns `true` for a clean desk; `false` for a desk with counted paths,
 *   commits ahead of its upstream, or no readable tree.
 */
export const deskClean = (dirty: readonly string[] | null, unpushed: number | null): boolean =>
  dirty !== null && dirty.length === 0 && (unpushed === null || unpushed === 0);
