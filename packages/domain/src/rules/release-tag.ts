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

import type { BranchClaim, SliceReference } from './cross-repo-reference.js';

/**
 * One row {@link releasePr} reads: a plan claim line's PR reference — as
 * {@link BranchClaim} reports it — joined with whether its branch was
 * deferred.
 */
export interface ReleasePrRow {
  /** The PR, as a claim line names it; `null` where the branch's claim lines name none. */
  readonly reference: SliceReference | null;
  /** Whether the branch this row's claim line belongs to was deferred. */
  readonly deferred: boolean;
}

/** {@link releasePr}'s answer: where the plan's PRs live, or that it names none. */
export type ReleasePrResult =
  | { readonly outcome: 'local'; readonly numbers: readonly number[] }
  | { readonly outcome: 'all-foreign'; readonly repos: readonly string[] }
  | { readonly outcome: 'none' };

/**
 * Where the PR that ships a plan lives: this repository, only other
 * repositories, or nowhere a non-deferred claim names.
 *
 * A reference with no `owner/repo` prefix is this repository's — local; every
 * `owner/repo#N` is foreign, including one naming this repository. A deferred
 * row is dropped before either count: it does not make a plan `all-foreign`
 * and does not join `local`'s numbers. A non-deferred row naming no reference
 * at all forces `none`, even where another row names a foreign PR — an
 * unannotated local branch must never read as shipped by another repository.
 *
 * @param rows - one row per PR a plan's claim lines name, plus one
 *   `reference: null` row per non-deferred branch whose claim lines name
 *   none — {@link BranchClaim} joined with each branch's deferral.
 * @returns `local` with every non-deferred local PR number; `all-foreign`
 *   with the foreign repositories, where every non-deferred row is foreign;
 *   `none`, where no non-deferred row names a PR or a non-deferred row names
 *   none.
 */
export const releasePr = (rows: readonly ReleasePrRow[]): ReleasePrResult => {
  const shipped = rows.filter((row) => !row.deferred);
  if (shipped.some((row) => row.reference === null)) return { outcome: 'none' };
  const local = shipped
    .filter((row) => row.reference!.repo === '')
    .map((row) => row.reference!.number);
  if (local.length > 0) return { outcome: 'local', numbers: local };
  const foreign = [...new Set(shipped.map((row) => row.reference!.repo))];
  return foreign.length > 0 ? { outcome: 'all-foreign', repos: foreign } : { outcome: 'none' };
};

/** What the caller read before asking. */
export interface ReleaseTagReading {
  /** {@link releasePr}'s answer for the plan, or `''` where it names none. */
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
          ? 'names no \'→ #N\' annotation on a slice that was not deferred — the version cannot be resolved from a merge commit that does not exist.'
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
