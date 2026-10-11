/** The directory every brief lives in, relative to the repository root. */
export const BRIEFS_DIR = '.plot/briefs';

/**
 * Where a branch's hand-off brief lives: `.plot/briefs/<slug>.md`, the slug
 * being the branch name after its LAST `/`.
 *
 * The prefix is dropped rather than flattened. `feature/a-brief-has-one-name`
 * gives `.plot/briefs/a-brief-has-one-name.md`, never
 * `feature-a-brief-has-one-name.md`.
 *
 * `packages/fleet/src/shared/brief-path.ts` delegates here. `plot-dispatch.sh`
 * holds the same rule as a parameter expansion.
 *
 * @param branch - a branch name, with or without a `/` prefix.
 * @returns the brief's path, relative to the repository root.
 */
export const briefPath = (branch: string): string => `${BRIEFS_DIR}/${branch.slice(branch.lastIndexOf('/') + 1)}.md`;
