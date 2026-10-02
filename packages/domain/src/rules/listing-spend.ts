import type { SpendRate } from './budget-record.js';
import { refreshIntervalMs } from './cadence.js';

/** What the caller knows when it asks whether it may list now. */
export interface ListingSpendInput {
  /** The unstretched interval between listings, in ms. */
  readonly intervalMs: number;
  /** What one listing costs in host requests. */
  readonly costPerListing: number;
  /**
   * What the record says this account is spending, or null where it was not
   * read or holds no rate to read.
   */
  readonly rate: Pick<SpendRate, 'perHour'> | null;
  /**
   * When this caller last completed a listing, in ms on the same clock as
   * `now`, or null where it has never listed.
   */
  readonly lastListedAt: number | null;
  /** Now, in ms. */
  readonly now: number;
  /**
   * The interval this caller is listing at right now, which is what lets it
   * subtract its own contribution from the observed rate. Defaults to the
   * unstretched interval, which is where a caller starts.
   */
  readonly currentIntervalMs?: number;
}

/** The previous listing a deferred caller reuses. */
export interface ListingReuse {
  /** When that listing was made, in ms. */
  readonly listedAt: number;
  /** How much older than `now` it is, in ms. Never negative. */
  readonly ageMs: number;
}

/** Whether a caller may spend a listing now, and what it reuses if not. */
export interface ListingSpendVerdict {
  /** True where the caller may spend a listing now. */
  readonly spend: boolean;
  /**
   * The listing to reuse, or null where there is none to reuse — which is the
   * first reading, and is always permitted. Null never means an empty listing.
   */
  readonly reuse: ListingReuse | null;
  /** The stretched interval this verdict was decided against, in ms. */
  readonly intervalMs: number;
  /** When the next listing is due, in ms on the same clock as `now`. */
  readonly nextAt: number;
}

/**
 * Decides whether a caller may spend a pull-request listing now.
 *
 * The interval is {@link refreshIntervalMs}, so the stretch, its ceiling and its
 * damping are the cadence's and this holds no second copy of them. A caller
 * whose last listing is older than that interval may list; one whose listing is
 * younger reuses it and is told its age.
 *
 * The first reading is always permitted: a caller that has never listed has
 * nothing to reuse, and deferring there would leave it with no answer at all.
 *
 * An absent rate leaves the cadence at the unstretched interval, so a caller on
 * an unread record lists exactly as often as it did before this rule existed.
 *
 * @param input - the interval, the cost of one listing, the account's rate, when
 *   this caller last listed, and now.
 * @returns whether to spend, the previous listing to reuse where it may not, the
 *   interval the verdict was decided against, and when the next listing is due.
 */
export const listingSpend = (input: ListingSpendInput): ListingSpendVerdict => {
  const { intervalMs, costPerListing, rate, lastListedAt, now } = input;
  const current = input.currentIntervalMs ?? intervalMs * costPerListing;
  const stretched = refreshIntervalMs(intervalMs, costPerListing, rate, current);
  // NO PREVIOUS LISTING IS NOT A STALE ONE. A caller that has never listed is
  // permitted whatever the rate says, and reports no reuse rather than an age
  // measured from a listing that never happened.
  if (lastListedAt === null) {
    return { spend: true, reuse: null, intervalMs: stretched, nextAt: now };
  }
  const nextAt = lastListedAt + stretched;
  if (now >= nextAt) {
    return { spend: true, reuse: null, intervalMs: stretched, nextAt };
  }
  // A DEFERRED CALLER NAMES WHAT IT REUSES AND HOW OLD IT IS. The age is what
  // makes the reused listing reportable as older than the pulse; without it a
  // caller can only report a fresh answer or none, and none reads as "no PRs".
  //
  // Floored at zero rather than trusted: a clock that moved backwards is not
  // evidence of a listing made in the future.
  return {
    spend: false,
    reuse: { listedAt: lastListedAt, ageMs: Math.max(0, now - lastListedAt) },
    intervalMs: stretched,
    nextAt,
  };
};
