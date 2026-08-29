import { z } from 'zod';

/**
 * Where a release sits in its life.
 *
 * Derived, never stored: a release has a life before its tag exists.
 */
export const ReleaseStateSchema = z.enum(['planned', 'candidate', 'shipped']);
export type ReleaseState = z.infer<typeof ReleaseStateSchema>;

/** Whether the tag is a release or a candidate for one. */
export const ReleaseChannelSchema = z.enum(['release', 'rc']);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

/**
 * A version of the software, identified by its tag.
 *
 * Identity: a natural key — the version, which fails by the source lying.
 * State: derived, so it goes stale and is re-run rather than stored.
 */
export interface Release {
  /** The tag, canonically `vN.N.N` — the identity. */
  version: string;
  /** Where it sits in its life. */
  state: ReleaseState;
  /** The tag's date, ISO-8601; null while planned. */
  date: string | null;
  /** The tag's commit sha; null while planned. */
  commit: string | null;
  /** Whether the tag names a release or a candidate. */
  channel: ReleaseChannel;
  /** The RC checklist's path, or null. */
  checklist: string | null;
}

/**
 * Normalizes a recorded version to the canonical `vN.N.N` spelling.
 *
 * Both spellings appear in one field across this estate — 70 `Released:` lines
 * carry the `v` and 40 do not — while every git tag carries it, so a consumer
 * matching the recorded string against `git tag` resolves 70 and misses 40.
 *
 * @param version - the version as recorded, with or without the prefix.
 * @returns the version prefixed with `v`; `''` stays empty.
 */
export const normalizeVersion = (version: string): string => {
  const trimmed = version.trim();
  if (trimmed === '') return '';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
};

/**
 * Whether two recorded versions name the same release.
 *
 * @param one - a version as recorded.
 * @param other - the version to compare against.
 * @returns true when both normalize to the same tag.
 */
export const sameVersion = (one: string, other: string): boolean =>
  normalizeVersion(one) === normalizeVersion(other);

/**
 * Reads a tag as a release channel.
 *
 * A suffixed tag is a candidate: `v2.1.0-rc.1` is not a release.
 *
 * @param version - the tag to read.
 * @returns `rc` when the tag carries a pre-release suffix, else `release`.
 */
export const channelFor = (version: string): ReleaseChannel =>
  normalizeVersion(version).includes('-') ? 'rc' : 'release';

/**
 * Whether this release has shipped.
 *
 * @param release - the release to test.
 * @returns true when a tag exists for it.
 */
export const hasShipped = (release: Release): boolean => release.state === 'shipped';
