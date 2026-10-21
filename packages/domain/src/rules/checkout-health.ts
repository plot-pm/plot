import type { BoardStatus } from './default-branch.js';

/**
 * What the board can say about its own checkout — the one it reads plans
 * from, not any desk. Resolves the plan's second open question
 * (`docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`): #2311's
 * board showed delivered plans as "in progress" because the checkout it read
 * was dirty and behind, with nothing saying so. `main-checkout` (the PreToolUse
 * gate) stops a future recurrence; this says so when one has already happened,
 * so the next incident costs a warning instead of an hour of investigation.
 *
 * @param clean - whether `git status --porcelain` reports nothing, or null
 *   where it could not be read.
 * @param behind - commits the checkout is behind the ref the board reads
 *   plans from, or null where that is unanswerable (see `measureBehind` in
 *   `packages/board/src/server/board.ts`).
 * @returns a status entry while the checkout is dirty or behind; null when
 *   both readings say nothing is wrong, or neither can be read.
 */
export const checkoutHealthStatus = (clean: boolean | null, behind: number | null): BoardStatus | null => {
  const dirty = clean === false;
  const stale = behind !== null && behind > 0;
  if (!dirty && !stale) return null;
  const parts: string[] = [];
  if (dirty) parts.push('has uncommitted changes');
  if (stale) parts.push(`is ${behind} commit${behind === 1 ? '' : 's'} behind`);
  return {
    key: 'checkout-health',
    severity: 20,
    tone: dirty ? 'rose' : 'amber',
    text: `The board's checkout ${parts.join(' and ')} — plans may show stale state.`,
  };
};
