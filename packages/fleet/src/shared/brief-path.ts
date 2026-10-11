/**
 * The one place that turns a branch name into its hand-off brief's path.
 *
 * A leaf module with no imports beyond the domain's rule, so every reader can
 * take it without a cycle — `attention.ts`, `auto-dispatch.ts`, `continue.ts` and
 * `fleet.ts` all sit in `server/` and previously each carried its own copy.
 */
import { BRIEFS_DIR, briefPath } from '@plot-pm/domain/rules/brief-path';

/**
 * The directory every brief lives in, and where a branch's hand-off brief
 * lives: `.plot/briefs/<slug>.md`, the slug being the branch name after its
 * LAST `/`. Both are the domain's (`packages/domain/src/rules/brief-path.ts`),
 * re-exported so the fleet's and the board's readers keep this import path,
 * and so the brief-name gate's rule and every reader compute one answer.
 */
export { BRIEFS_DIR, briefPath };

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
