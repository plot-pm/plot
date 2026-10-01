/**
 * Where Plot creates dispatch worktrees and writes its action records.
 *
 * One rule, so that every reader looks in one place for one desk. The answer is
 * `<repo>/.worktrees` unless the repository configured a `Worktree root`, in
 * which case an absolute value is taken as given and a relative one resolves
 * against the repository root.
 *
 * It is string work: no path it returns need exist, and it reaches no
 * filesystem. The domain may import `zod` and nothing else outside
 * `adapters/`, so the composition here is plain string handling rather than
 * `node:path`.
 *
 * Paths are POSIX: a value is absolute when it starts with `/`. Plot's shell
 * estate and its board both run on POSIX paths, and a Windows drive letter is
 * not a shape this rule has ever been handed.
 *
 * @concept desk-root
 */

/** The directory under the repository root when nothing is configured. */
export const DEFAULT_DESK_ROOT = '.worktrees';

/** What the caller read before asking. */
export interface DeskRootReading {
  /** The `Worktree root` value as configured; empty when the key is absent. */
  readonly configured: string;
  /**
   * Absolute path to the repository's MAIN checkout.
   *
   * The caller resolves it. This composes strings and reaches no working
   * directory, so a relative root composes a relative answer — which a caller
   * would then resolve against its own cwd rather than the repository's.
   */
  readonly repoRoot: string;
}

/** A path, and where it sits relative to the repository. */
export interface DeskRootPlacement {
  /** Whether the desk root lies inside the repository. */
  readonly inside: boolean;
  /**
   * The desk root as a repository-relative path with a leading and trailing
   * `/`, in the form `git check-ignore` and `info/exclude` take — `undefined`
   * when the root lies outside the repository.
   */
  readonly excludeLine?: string;
}

/** Removes trailing `/` from a path, keeping a lone `/` intact. */
const trimTrailing = (p: string): string => {
  let end = p.length;
  while (end > 1 && p[end - 1] === '/') end -= 1;
  return p.slice(0, end);
};

/** Joins a segment under a root, never doubling the separator. */
const join = (root: string, segment: string): string =>
  root.endsWith('/') ? `${root}${segment}` : `${root}/${segment}`;

/**
 * Resolves the desk root from the configured value and the repository root.
 *
 * An empty `configured` is the absent row, never a relative path: a repository
 * that declares the key with no value has configured nothing.
 *
 * @param reading - the configured `Worktree root` and the main checkout's path.
 * @returns an absolute directory path with no trailing slash; it need not exist.
 */
export const deskRoot = (reading: DeskRootReading): string => {
  const root = trimTrailing(reading.repoRoot.trim());
  const configured = reading.configured.trim();
  if (configured === '') return join(root, DEFAULT_DESK_ROOT);
  if (configured.startsWith('/')) return trimTrailing(configured);
  return join(root, trimTrailing(configured));
};

/**
 * Whether a desk root lies inside the repository, and the line that excludes it.
 *
 * A root equal to the repository root is not inside it: excluding the whole
 * checkout is never the answer, and no configured value composes to one.
 *
 * @param reading - the configured `Worktree root` and the main checkout's path.
 * @returns whether the root is inside the repository, and its exclude line.
 */
export const deskRootPlacement = (reading: DeskRootReading): DeskRootPlacement => {
  const root = trimTrailing(reading.repoRoot.trim());
  const resolved = deskRoot(reading);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!resolved.startsWith(prefix)) return { inside: false };
  return { inside: true, excludeLine: `/${resolved.slice(prefix.length)}/` };
};
