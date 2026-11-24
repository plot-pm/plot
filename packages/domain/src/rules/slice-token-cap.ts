import type { TokenCounts } from './slice-tokens.js';

/**
 * What {@link sliceTokenCap} answers about one slice.
 *
 * - `under` — the slice's counted tokens are below the cap; the next run may start.
 * - `reached` — the slice's counted tokens are at or above the cap; no further run starts.
 * - `unread` — the slice's tokens could not be read; the next run may start.
 */
export type SliceTokenCap = 'under' | 'reached' | 'unread';

/**
 * The tokens one slice's spend counts against `Slice max tokens`: input,
 * output and cache-creation tokens, unweighted. Cache-read tokens count zero.
 *
 * The sum is computed on each call and is a cap, not a cost.
 *
 * @param tokens - the slice's four counters.
 * @returns `inputTokens + outputTokens + cacheCreationTokens`.
 */
export const countedTokens = (tokens: TokenCounts): number =>
  tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens;

/**
 * Whether a slice has reached `Slice max tokens` and may start no further run.
 *
 * @param spent - the slice's tokens so far, sealed and unsealed; `null` where
 *   they could not be read.
 * @param cap - `Slice max tokens`, a positive whole number. A caller with no
 *   configured key does not call this.
 * @returns `unread` where `spent` is `null`; `reached` where
 *   {@link countedTokens} of `spent` is at or above `cap`; `under` otherwise.
 *   It never throws.
 */
export const sliceTokenCap = (spent: TokenCounts | null, cap: number): SliceTokenCap => {
  if (spent === null) return 'unread';
  return countedTokens(spent) >= cap ? 'reached' : 'under';
};
