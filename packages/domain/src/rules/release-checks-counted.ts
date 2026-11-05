import type { Checks } from '../entities/pr.js';

/**
 * Whether the merge counts a passing CI check on the pinned head.
 *
 * Reads the PR's check rollup with `plot/review` excluded. `plot/review` is
 * Plot's own status and satisfies no required check, so a rollup holding
 * nothing else reads `none` and is not counted. A run that exists only as a
 * dispatched run on the head is outside the rollup and is not counted either.
 *
 * @param ciChecks - the rollup's colour without `plot/review`, bound to the pinned head; absent where the host did not report it.
 * @returns `true` only where the colour is `green`; an absent, `none`, `pending`, `failing` or `unknown` reading is not a pass.
 */
export const ciCounted = (ciChecks: Checks | undefined): boolean => ciChecks === 'green';
