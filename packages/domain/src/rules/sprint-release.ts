import type { SprintOwner } from './issue-source.js';

/**
 * Compares a Plot sprint's Must-haves against a tracker Release's issues.
 *
 * The sprint file is the commitment and the Release is read beside it — this
 * rule never writes to either. Two findings travel apart, never folded into
 * one "mismatch" bucket: a Must-have the Release does not carry, and a
 * Release issue no Must-have names.
 */

/** One Must-have as this rule reads it. */
export interface SprintReleaseItem {
  /** The sprint's own wording of the item. */
  text: string;
  /** The tracker issue key the item's plan names; `''` where it names none. */
  issue: string;
}

/** What the comparison found, in both directions. */
export interface SprintReleaseDrift {
  /** Must-haves naming an issue the Release's `issues` does not carry. */
  readonly missingFromRelease: readonly SprintReleaseItem[];
  /** Release issue keys no Must-have names. */
  readonly missingFromSprint: readonly string[];
}

/**
 * Compares Must-haves against a Release's issue keys.
 *
 * **Matching is by issue key only.** The caller supplies each Must-have's key.
 * A Must-have with key `''` names no issue: it appears in neither list, and
 * its text is never matched against the Release.
 *
 * @param mustHaves - the sprint's Must-have items, each with the issue key its plan names, or `''`.
 * @param releaseIssueKeys - the Jira keys `Tracker.versionRead` answered for the Release.
 * @returns the drift in both directions.
 */
export const sprintReleaseDrift = (
  mustHaves: readonly SprintReleaseItem[],
  releaseIssueKeys: readonly string[],
): SprintReleaseDrift => {
  const releaseKeys = new Set(releaseIssueKeys);
  const namedKeys = new Set(mustHaves.map((item) => item.issue).filter((issue) => issue !== ''));
  return {
    missingFromRelease: mustHaves.filter((item) => item.issue !== '' && !releaseKeys.has(item.issue)),
    missingFromSprint: releaseIssueKeys.filter((key) => !namedKeys.has(key)),
  };
};

/**
 * Decides whether a sprint's `Release:` target is read from the tracker.
 *
 * The Release is read only where Plot owns the sprint and the declared
 * tracker's scheme has a version concept. Every other repository reads
 * nothing and reports no Release drift.
 *
 * @param owner - the {@link SprintOwner} answer for this repository.
 * @param declaredTracker - the `Tracker` config key's value, verbatim; `''` where none is declared.
 * @param versionSchemes - the tracker schemes whose connector reads a version, as the adapters declare them.
 * @returns `true` where the Release is read.
 */
export const releaseIsRead = (
  owner: SprintOwner,
  declaredTracker: string,
  versionSchemes: readonly string[],
): boolean => {
  const scheme = declaredTracker.trim().split(/\s+/, 1).join('').toLowerCase();
  return owner.owns === 'plot' && versionSchemes.includes(scheme);
};
