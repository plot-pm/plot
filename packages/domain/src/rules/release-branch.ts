/**
 * The branch a `changeset-release` PR rides on — the ONE name this repo matches.
 *
 * Matched by anchored prefix, not `includes`: `feature/changeset-release-notes`
 * does not match, because the segment it carries is not the branch's start.
 *
 * SHARED ACROSS TWO READERS: the board's row-kind derivation and `merge`'s own
 * refusal of a release PR both ask this one question of the same string, so a
 * second copy at either site would be the defect.
 *
 * @concept release-branch
 */
export const RELEASE_BRANCH = /^changeset-release\//;
