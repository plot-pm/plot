/**
 * Compares a Plot sprint's Must-haves against a Jira Release's issues.
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
  /** The Jira issue key the item names, read from the plan's `Issue:` field; `''` where it names none. */
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
 * **Matching is by issue key only, read from the plan's `Issue:` field.** A
 * Must-have with no `Issue:` field names no issue and is reported missing
 * from the Release rather than guessed at from its text — the narrow, stated
 * interpretation this branch picked where the plan left the question open.
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
