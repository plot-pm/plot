/**
 * The one place that turns a branch name into its hand-off brief's path.
 *
 * A leaf module with no imports beyond `node:path`, so every reader can take it
 * without a cycle — `attention.ts`, `auto-dispatch.ts`, `continue.ts` and
 * `fleet.ts` all sit in `server/` and previously each carried its own copy.
 */
import path from 'node:path';

/** The directory every brief lives in, relative to the repository root. */
export const BRIEFS_DIR = '.plot/briefs';

/**
 * Where a branch's hand-off brief lives: `.plot/briefs/<slug>.md`, the slug
 * being the branch name after its LAST `/`.
 *
 * The prefix is dropped rather than flattened. `feature/a-brief-has-one-name`
 * gives `.plot/briefs/a-brief-has-one-name.md`, never
 * `feature-a-brief-has-one-name.md` — a flattened name is a file no reader
 * computes, so a brief written that way is invisible to the dispatch gate and
 * the branch reads as having none.
 *
 * The shell holds the same rule as `${1##*/}` in `plot-dispatch.sh`; it cannot
 * import this, so `test/reconcile/briefpath.test.mjs` asserts the two agree on
 * the same inputs.
 *
 * @param branch A branch name, with or without a `/` prefix.
 * @returns The brief's path, relative to the repository root.
 */
export const briefPath = (branch: string): string =>
  path.join(BRIEFS_DIR, `${branch.split('/').pop() ?? branch}.md`);

/**
 * The brief path for a `same-branch` plan, which names a plan SLUG rather than
 * a branch.
 *
 * Such a plan rides a branch it did not cut, so there is no prefix to strip and
 * no branch whose last segment would identify it. The slug is used whole. It
 * passes through `briefPath` regardless, because a slug contains no `/` and the
 * two therefore agree — this export exists to name the caller's intent, not to
 * compute something different.
 *
 * @param slug A plan slug, as it appears in the plan's filename.
 * @returns The brief's path, relative to the repository root.
 */
export const briefPathForSlug = (slug: string): string => briefPath(slug);
