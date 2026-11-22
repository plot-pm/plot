import type { StateHome } from '../entities/state-home.js';

/** A found home, or the answer that none could be told. */
export type StateHomeAnswer = { readonly home: StateHome } | { readonly unread: true };

/**
 * The state home of a repository, from its common git directory.
 *
 * @param commonDir - the absolute, realpathed common git directory, or `null`
 *   where git did not answer.
 * @returns `{ home }`, the directory's parent, where its last segment is
 *   `.git`; `{ unread: true }` otherwise. Never answers the input path.
 */
export const stateHomeOf = (commonDir: string | null): StateHomeAnswer => {
  if (commonDir === null) return { unread: true };
  const dir = commonDir.replace(/\/+$/, '');
  const cut = dir.lastIndexOf('/');
  if (cut < 0 || dir.slice(cut + 1) !== '.git') return { unread: true };
  return { home: (cut === 0 ? '/' : dir.slice(0, cut)) as StateHome };
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
