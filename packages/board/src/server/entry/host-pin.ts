import type { Host } from '@plot-pm/domain';

/**
 * Whether a backend word names a host that can pin a merge to a commit.
 *
 * `plot-host.sh pr-merge --match-head` requires the flag on every backend.
 * Bitbucket Cloud's merge endpoint takes no head precondition (measured
 * 2026-10-18 against its OpenAPI spec), so its arm re-reads the head
 * immediately before merging and refuses `head-moved` on a mismatch — a
 * reduced window rather than a true pin, but the flag is honoured on every
 * backend this adapter resolves.
 *
 * @param backend - the word `plot-host.sh` resolved, or `''` where it did not answer.
 * @returns true always, so an unanswered backend keeps the pin too.
 */
export const hostPinsMerges = (_backend: string): boolean => true;

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
