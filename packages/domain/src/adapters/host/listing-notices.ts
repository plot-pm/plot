import type { PrListingCompleteness } from '../../ports/host.js';
import { listingWords } from '../../rules/listing-page.js';

/** `plot-host.sh`'s per-state claim that a page or a window is whole. */
const STATE_CLAIM = /pr-list state=(\S+) (?:page|window) complete\b/g;

/** `plot-host.sh`'s per-state report that a page may be truncated. */
const STATE_DOUBT = /pr-list state=(\S+) possibly truncated\b/g;

/** `plot-host.sh`'s claim that a branch sweep asked every branch and each state answered. */
const SWEEP_CLAIM = /pr-list sweep complete\b/;

/**
 * Reads `plot-host.sh pr-list`'s stderr notices into one completeness word per
 * state.
 *
 * A state that a notice names is `whole` where a `page complete` or `window
 * complete` notice claims it and no `possibly truncated` notice names it. The
 * asked state is `whole` where a notice claims it, where a `sweep complete`
 * notice claims the whole call, or where no notice names it, at least one
 * notice names another state, and every named state is `whole`. Every other
 * state, the asked state of a call with no notice included, is
 * `possibly-truncated`.
 *
 * @param stderr - the call's stderr, or the partial answer's sentence.
 * @param asked - the state word the call asked for.
 * @returns the word per state; the asked state is always present.
 */
export const listingCompleteness = (stderr: string, asked: string): Record<string, PrListingCompleteness> => {
  const claimed = new Set([...stderr.matchAll(STATE_CLAIM)].map((match) => match[1]));
  const doubted = new Set([...stderr.matchAll(STATE_DOUBT)].map((match) => match[1]));
  return listingWords({ claimed, doubted, sweep: SWEEP_CLAIM.test(stderr) }, asked);
};
