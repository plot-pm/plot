/**
 * Whether a host backend's `pr-state` carries the CI-only check rollup.
 *
 * @param backend - the git host's backend word, or `''` where it did not answer.
 * @returns `true` for GitHub; `false` for every other backend and an unresolved one.
 */
export const reportsCiChecks = (backend: string): boolean => backend === 'github';
