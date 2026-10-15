import type { Host } from '@plot-pm/domain';

/**
 * Whether a backend word names a host that can pin a merge to a commit.
 *
 * `plot-host.sh pr-merge --match-head` exits 4 on Bitbucket, which cannot pin,
 * and requires the flag on every other backend.
 *
 * @param backend - the word `plot-host.sh` resolved, or `''` where it did not answer.
 * @returns false for Bitbucket; true otherwise, so an unanswered backend keeps the pin.
 */
export const hostPinsMerges = (backend: string): boolean => backend !== 'bitbucket';

/**
 * Asks the host port whether a merge through it is pinned to a head commit.
 *
 * @param host - the host port.
 * @returns {@link hostPinsMerges} of the resolved backend; true where the backend does not answer.
 */
export const canPinMerge = async (host: Host): Promise<boolean> => {
  const backend = await host.backend();
  return hostPinsMerges(backend.ok ? backend.value : '');
};
