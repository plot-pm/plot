import type { StateHome } from '../entities/state-home.js';
import { mainCheckoutOf } from './main-checkout.js';

/** A found home, or the answer that none could be told. */
export type StateHomeAnswer = { readonly home: StateHome } | { readonly unread: true };

/**
 * The state home of a repository: its main checkout, from {@link mainCheckoutOf}.
 *
 * @param commonDir - the absolute, realpathed common git directory, or `null`
 *   where git did not answer.
 * @param coreWorktree - the common directory's `core.worktree` value, or `null`
 *   where the key is unset or was not read.
 * @returns `{ home }`, the main checkout {@link mainCheckoutOf} answers;
 *   `{ unread: true }` where it answers none. Never answers the input path.
 */
export const stateHomeOf = (commonDir: string | null, coreWorktree: string | null): StateHomeAnswer => {
  const answer = mainCheckoutOf(commonDir, coreWorktree);
  return 'checkout' in answer ? { home: answer.checkout as StateHome } : { unread: true };
};

/** Whether a process found its state home: `read`, or `unaskable` where git could not name it. */
export type StateHomeRead = 'read' | 'unaskable';

/**
 * The {@link StateHomeRead} of a resolved state home.
 *
 * @param answer - the resolved state home.
 * @returns `read` where the answer names a home, `unaskable` where it is unread.
 */
export const stateHomeReadOf = (answer: StateHomeAnswer): StateHomeRead => ('home' in answer ? 'read' : 'unaskable');
