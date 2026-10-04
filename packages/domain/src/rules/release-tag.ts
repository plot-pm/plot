/**
 * Which `vX.Y.Z` tag shipped a plan's merge commit, and whether it matches the
 * version a release names.
 *
 * THE VERSION COMES FROM THE PLAN'S MERGE COMMIT, NEVER FROM A DATE OR A PR
 * TITLE. The release that shipped a commit is the FIRST `vX.Y.Z` tag
 * containing it, sorted by version rather than by git's own `--contains`
 * order — a plan booked on one date can ship in a release cut months later,
 * and two tags can share a date.
 *
 * FOUR REFUSALS, NAMED SEPARATELY, because each has a different repair: no
 * `→ #N` annotation or no `mergeCommit` (the PR never merged, or the host's
 * answer carries none); no tag reads `v<version>` at all; a tag exists but
 * does not contain the merge commit; and the first tag that DOES contain it is
 * a different version. The third is the one a plain `--contains | head -1`
 * without a version sort would pass silently.
 *
 * @concept release-tag
 */

/** What the caller read before asking. */
export interface ReleaseTagReading {
  /** The plan's last `→ #N` PR number, or `''` where it names none. */
  readonly lastPr: string;
  /** That PR's merge commit sha, or `''` where the host answered none. */
  readonly mergeCommit: string;
  /**
   * The `vX.Y.Z` tags containing {@link mergeCommit}, sorted oldest version
   * first — {@link Refs.tagsContaining}'s answer, read only once a merge
   * commit exists to ask about.
   */
  readonly containingTags: readonly string[];
  /** The version a release names, with or without its `v` prefix. */
  readonly wantedVersion: string;
}

/** The release tag resolved, or the refusal naming why it could not be. */
export type ReleaseTagResult =
  | { readonly outcome: 'resolved'; readonly tag: string }
  | {
      readonly outcome: 'refused';
      readonly reason: 'no-merge-commit' | 'no-tag' | 'tag-does-not-contain' | 'tag-mismatch';
      readonly detail: string;
    };

/** `v<version>` with any existing `v`/`V` prefix stripped first, matching the shell's normalisation. */
const asTag = (version: string): string => `v${version.replace(/^[Vv]/, '')}`;

/**
 * Resolves the tag that shipped a plan's merge commit, and checks it against
 * the version a release names.
 *
 * @param reading - the merge commit, its containing tags, and the wanted version.
 * @returns the resolved tag, or a refusal naming which of the four gates fired.
 */
export const releaseTag = (reading: ReleaseTagReading): ReleaseTagResult => {
  if (reading.lastPr === '' || reading.mergeCommit === '') {
    return {
      outcome: 'refused',
      reason: 'no-merge-commit',
      detail:
        reading.lastPr === ''
          ? 'names no \'→ #N\' annotation — the version cannot be resolved from a merge commit that does not exist.'
          : `its last PR (#${reading.lastPr}) carries no mergeCommit — it may not have merged, or the host could not answer.`,
    };
  }

  const wanted = asTag(reading.wantedVersion);
  const firstTag = reading.containingTags[0];

  if (firstTag === undefined) {
    return {
      outcome: 'refused',
      reason: 'no-tag',
      detail: `no 'v*.*.*' tag contains the merge commit (${reading.mergeCommit}, from PR #${reading.lastPr}).`,
    };
  }
  if (!reading.containingTags.includes(wanted)) {
    return {
      outcome: 'refused',
      reason: 'tag-does-not-contain',
      detail: `tag '${wanted}' does not contain the merge commit (${reading.mergeCommit}, from PR #${reading.lastPr}). The tags that do: ${reading.containingTags.join(' ')}`,
    };
  }
  if (firstTag !== wanted) {
    return {
      outcome: 'refused',
      reason: 'tag-mismatch',
      detail: `shipped in '${firstTag}', not '${wanted}' — '${firstTag}' is the FIRST tag (by version) containing the merge commit (${reading.mergeCommit}, from PR #${reading.lastPr}).`,
    };
  }
  return { outcome: 'resolved', tag: wanted };
};
