import type { BoardStatus } from './default-branch.js';

/**
 * The status entry for the board's own checkout — the one it reads plans
 * from, not any desk — while that checkout has uncommitted changes
 * (`docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`, #2311).
 *
 * A checkout behind its plan ref is not reported here: `PlanSourceLine`
 * already shows "checkout N behind" from the same `planSource.behind` reading.
 *
 * @param clean - whether `git status --porcelain` reports nothing, or null
 *   where it could not be read.
 * @returns a rose status entry while the checkout is dirty; null when it is
 *   clean or its state cannot be read.
 */
export const checkoutHealthStatus = (clean: boolean | null): BoardStatus | null =>
  clean === false
    ? {
        key: 'checkout-health',
        severity: 20,
        tone: 'rose',
        text: "The board's checkout has uncommitted changes — plans may show stale state.",
      }
    : null;
