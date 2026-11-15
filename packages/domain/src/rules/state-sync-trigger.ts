import { writeTarget } from './write-target.js';

/**
 * The refs one state-sync run reads, as one string: the `State branch` key,
 * the default branch, and the object each of the state ref, its tracking ref,
 * the local default branch and its tracking ref points at.
 *
 * @param key - the `State branch` value as configured; empty where the key is absent.
 * @param defaultBranch - the default branch's short name, such as `main`.
 * @param oidOf - the object a full ref name points at, or undefined where it does not exist.
 * @returns null where no key is declared, so no run has anything to do; the
 *   key alone where it names no usable ref; the key and the four tips otherwise.
 */
export const stateSyncStamp = (
  key: string,
  defaultBranch: string,
  oidOf: (ref: string) => string | undefined,
): string | null => {
  const target = writeTarget(key, defaultBranch);
  if (target.kind === 'none') return null;
  if (target.kind === 'invalid') return `invalid ${key.trim()}`;
  const refs = [target.pushRef, target.trackRef, `refs/heads/${defaultBranch}`, target.defaultRef];
  return [key.trim(), defaultBranch, ...refs.map((ref) => `${ref}=${oidOf(ref) ?? '-'}`)].join('\n');
};

/**
 * Whether a state-sync run is due: the refs it reads moved since the last run
 * that settled, or no run has settled yet.
 *
 * @param settled - the stamp of the last run that settled; null before the first.
 * @param now - the stamp now, from {@link stateSyncStamp}.
 * @returns false where no key is declared or nothing moved; true otherwise.
 */
export const stateSyncDue = (settled: string | null, now: string | null): boolean => now !== null && now !== settled;
