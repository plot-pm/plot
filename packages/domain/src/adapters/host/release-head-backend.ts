/**
 * Whether a host backend runs the changesets release workflow whose head
 * {@link releaseApproveAt} reads through `Refs.headChanges`. Only GitHub
 * opens the `changeset-release/main` PR, so every other backend answers
 * `false` without the workflow itself naming a vendor.
 *
 * @param backend - the git host's backend word.
 * @returns `true` for GitHub; `false` otherwise.
 */
export const readsReleaseHead = (backend: string): boolean => backend === 'github';
