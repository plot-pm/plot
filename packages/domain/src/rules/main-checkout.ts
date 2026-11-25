/** The main checkout of a repository, or the answer that none could be told. */
export type MainCheckoutAnswer = { readonly checkout: string } | { readonly unread: true };

const UNREAD: MainCheckoutAnswer = { unread: true };

/** `path` with `.` and `..` segments and repeated or trailing slashes removed; absolute in, absolute out. */
const normalized = (path: string): string => {
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') kept.pop();
    else kept.push(segment);
  }
  return `/${kept.join('/')}`;
};

/**
 * The main checkout of a repository, from its common git directory and that
 * directory's `core.worktree` setting.
 *
 * Pure: it reads no file and resolves no symlink. The shell's
 * `plot_checkout_of_common` (`plot-desk-root.sh`) duplicates it, and
 * `corpus/main-checkout.corpus.test.ts` holds the pair.
 *
 * @param commonDir - the absolute common git directory, or `null` where git
 *   did not answer.
 * @param coreWorktree - the directory's `core.worktree` value, or `null` where
 *   the key is unset or was not read.
 * @returns `{ checkout }`: `coreWorktree` resolved against `commonDir` where it
 *   is set (taken as is where absolute), else the parent of a `commonDir` whose
 *   last segment is `.git`. `{ unread: true }` where `commonDir` is `null` or
 *   relative, or is not a `.git` directory and names no `coreWorktree`. Never
 *   answers the input path for a directory it cannot place.
 */
export const mainCheckoutOf = (commonDir: string | null, coreWorktree: string | null): MainCheckoutAnswer => {
  if (commonDir === null || !commonDir.startsWith('/')) return UNREAD;
  if (coreWorktree !== null) {
    return { checkout: normalized(coreWorktree.startsWith('/') ? coreWorktree : `${commonDir}/${coreWorktree}`) };
  }
  const dir = commonDir.replace(/\/+$/, '');
  const cut = dir.lastIndexOf('/');
  if (cut < 0 || dir.slice(cut + 1) !== '.git') return UNREAD;
  return { checkout: cut === 0 ? '/' : dir.slice(0, cut) };
};

/**
 * Whether the adapter must read `core.worktree` before it asks {@link mainCheckoutOf}.
 *
 * A `.git` directory lies in its checkout, so its key is never read: a `.git`
 * directory that sets `core.worktree` for another reason keeps its checkout.
 *
 * @param commonDir - the absolute common git directory.
 * @returns `true` where the directory's last segment is not `.git`.
 */
export const readsCoreWorktree = (commonDir: string): boolean => {
  const dir = commonDir.replace(/\/+$/, '');
  return dir.slice(dir.lastIndexOf('/') + 1) !== '.git';
};
