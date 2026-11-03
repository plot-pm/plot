/**
 * Whether a host backend is the one {@link mergeIdentity} asks the `Merger
 * app` key about. Only GitHub's ruleset gives a narrow App the chance to
 * satisfy a required check, so every other backend — Bitbucket included —
 * answers `false` without the rule itself naming a vendor.
 *
 * @param backend - the git host's backend word, or `''` where it did not answer.
 * @returns `true` for GitHub; `false` otherwise.
 */
export const asksMergerApp = (backend: string): boolean => backend === 'github';
