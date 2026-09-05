/**
 * What a PR lookup produced.
 *
 * `unaskable` is a THIRD value rather than an empty list, and the distinction
 * is the whole rule. A host holding no merged PR and a host that could not be
 * reached both yield nothing to read, and collapsing them makes silence look
 * like an answer.
 *
 * - `found` — the lookup ran and matched at least one PR.
 * - `none` — the lookup ran and matched no PR.
 * - `unaskable` — the lookup did not run, or did not answer.
 */
export type LookupReading = 'found' | 'none' | 'unaskable';

/**
 * Whether a branch's work reached the default branch.
 *
 * `unknown` is what a host that could not be asked produces. It is neither
 * `landed` nor `not-landed`, and {@link mayRemove} treats it as neither.
 */
export type LandedAnswer = 'landed' | 'not-landed' | 'unknown';

/**
 * What was looked up about one branch's PRs.
 *
 * Both fields are readings. The rule performs no I/O and reaches no host —
 * who asked, and with which CLI, is the caller's business, which is what makes
 * every arm below reachable from a plain function call with nothing installed.
 */
export interface PrReadings {
  /**
   * Whether any PR on this branch carries a merge timestamp.
   *
   * THE TIMESTAMP, NEVER THE STATE, and never ancestry. A merged PR reports
   * `CLOSED`, so a state reading refuses every squash-merged branch; and a
   * squash rewrites the commits, so the branch stays ahead of the default
   * branch forever and ancestry answers `not-landed` about work that landed.
   *
   * ANY PR, NOT THE NEWEST. A newer unmerged PR sitting in front of a real
   * merge makes a newest-only lookup report unlanded work as unlanded.
   */
  merged: LookupReading;
  /**
   * Whether the branch carries an open PR right now.
   *
   * A DIFFERENT QUESTION from {@link PrReadings.merged} and not a second
   * opinion on it. A branch can be reused after its own PR merged, so an open
   * PR stands on a branch whose older PR landed.
   */
  open: LookupReading;
}

/**
 * Did the host merge any PR for this branch?
 *
 * @param readings - what the lookups produced.
 * @returns `landed` when a merge timestamp was found, `not-landed` when the
 *   lookup ran and found none, `unknown` when it could not be asked.
 */
export const landed = (readings: PrReadings): LandedAnswer => {
  switch (readings.merged) {
    case 'found':
      return 'landed';
    case 'none':
      return 'not-landed';
    default:
      return 'unknown';
  }
};

/**
 * Does an open PR stand on this branch?
 *
 * @param readings - what the lookups produced.
 * @returns true only where the lookup ran and matched an open PR.
 */
export const openPr = (readings: PrReadings): boolean => readings.open === 'found';

/**
 * May a caller remove what this branch's work is held in?
 *
 * TRUE ONLY ON TWO POSITIVE READINGS: a merge was found, and an open PR was
 * not. Every other combination keeps.
 *
 * THE TWO FAILURE DIRECTIONS ARE COUPLED, and that coupling is why this is one
 * function rather than two a caller composes. {@link landed} and
 * {@link openPr} fail in the SAME direction — an unaskable host answers
 * `unknown` and `false` — but with OPPOSITE effects, because an open PR vetoes
 * a removal while a merge licenses one. So `openPr` is not safe alone: it
 * releases a veto on exactly the silence that ought to refuse. It is safe
 * because `landed` has already refused on that same silence, and this function
 * is where the pair is stated together.
 *
 * @param readings - what the lookups produced.
 * @returns true only where the host said merged and said no open PR stands.
 */
export const mayRemove = (readings: PrReadings): boolean =>
  landed(readings) === 'landed' && !openPr(readings);
