/** What the caller knows when it asks whether a refused listing may be retried. */
export interface ListingBackoffInput {
  /** When the held back-off ends, or null where none is held. */
  readonly backoffUntil: number | null;
  /**
   * The back-off interval that produced `backoffUntil`, in ms, or null where
   * none is held. Read only to grow the NEXT back-off on a repeated refusal —
   * never to decide `open`, which compares `backoffUntil` against `now` alone.
   */
  readonly backoffMs: number | null;
  /** Now, in ms. */
  readonly now: number;
}

/** Whether a listing may be spent now, and what a refusal or a success sets next. */
export interface ListingBackoffVerdict {
  /** True where a listing may be spent now — no back-off is held, or it has ended. */
  readonly open: boolean;
  /**
   * The back-off a refusal observed now would start or grow to. The caller
   * stores `now + onRefusalMs` as `backoffUntil` and `onRefusalMs` as
   * `backoffMs`.
   */
  readonly onRefusalMs: number;
}

/** The back-off a first refusal opens, and the one a success resets to. */
export const LISTING_BACKOFF_BASE_MS = 5_000;

/**
 * The back-off's ceiling. 240 × {@link LISTING_BACKOFF_BASE_MS} = 20 min:
 * growing the base by {@link LISTING_BACKOFF_GROWTH} reaches it in three
 * refusals, and a listing held there retries at most once every 20 min —
 * bounding a listing refused on every attempt after the first to 8 attempts an
 * hour in total (the first success plus 7 refused retries), regardless of how
 * long one scan pass takes.
 */
export const LISTING_BACKOFF_MAX_MS = LISTING_BACKOFF_BASE_MS * 240;

/** How much a repeated refusal multiplies the held back-off by. */
const LISTING_BACKOFF_GROWTH = 4;

/**
 * Decides whether a caller may spend a refused listing's retry now.
 *
 * Unlike a host-named rate-limit wait (`prNextDueAt`), a refused listing names
 * no duration — only a verdict. This rule derives one: a refusal with no
 * back-off held opens {@link LISTING_BACKOFF_BASE_MS}; a refusal observed while
 * one is already held multiplies IT (the interval that produced it, not the
 * time left on it) by {@link LISTING_BACKOFF_GROWTH}, capped at
 * {@link LISTING_BACKOFF_MAX_MS}. A success clears both fields outright — the
 * caller passes null, null on its next call — so the refusal after a success
 * starts from the base again rather than resuming where the back-off left off.
 *
 * `open` is decided from `backoffUntil` and `now` alone, never from
 * `backoffMs`: a caller that calls this repeatedly while a back-off is held
 * and not yet due gets the same `open: false` every time, and `onRefusalMs`
 * changes only because the caller only ever acts on it after a spend attempt
 * it was just told was open.
 *
 * @param input - the back-off currently held and the interval that produced
 *   it, or null for both, and now.
 * @returns whether the caller may spend a listing now, and the back-off a
 *   refusal observed now would set.
 */
export const listingBackoff = (input: ListingBackoffInput): ListingBackoffVerdict => {
  const { backoffUntil, backoffMs, now } = input;
  const open = backoffUntil === null || now >= backoffUntil;
  const onRefusalMs = backoffMs === null
    ? LISTING_BACKOFF_BASE_MS
    : Math.min(LISTING_BACKOFF_MAX_MS, backoffMs * LISTING_BACKOFF_GROWTH);
  return { open, onRefusalMs };
};
