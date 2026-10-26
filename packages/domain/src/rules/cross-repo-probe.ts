import type { PortResult } from '../port-result.js';

/**
 * How a cross-repo `owner/repo#N` reference finds the host it lives on.
 *
 * The checkout's own backend answers first. Only a clean miss asks the other
 * drivable backend, once. A failure on either ask stays a failure, so an
 * unreachable host never reads as a PR that does not exist.
 */

/**
 * Whether the first answer is a clean miss, which asks the other backend.
 *
 * @param first - the checkout's own backend's answer.
 * @param isMiss - whether an answered value means "no such PR here".
 * @returns true only where the first ask answered, and answered a miss.
 */
export const asksOtherHost = <T>(first: PortResult<T>, isMiss: (value: T) => boolean): boolean =>
  first.ok && isMiss(first.value);

/**
 * The answer a cross-repo reference resolves to, once both backends were asked.
 *
 * A failed retry is the answer, except `unaskable`: a backend with no answer at
 * all leaves the first backend's miss standing. A retry that misses too leaves
 * the first answer standing. A retry that finds the PR is the answer.
 *
 * @param first - the checkout's own backend's answer, a clean miss.
 * @param retry - the other backend's answer.
 * @param isMiss - whether an answered value means "no such PR here".
 * @returns the answer the caller reads.
 */
export const crossRepoAnswer = <T>(
  first: PortResult<T>,
  retry: PortResult<T>,
  isMiss: (value: T) => boolean,
): PortResult<T> => {
  if (!retry.ok) return retry.why === 'unaskable' ? first : retry;
  return isMiss(retry.value) ? first : retry;
};
