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
 * FIVE REFUSALS, NAMED SEPARATELY, because each has a different repair: no
 * `→ #N` annotation or no `mergeCommit` (the PR never merged, or the host's
 * answer carries none); no tag reads `v<version>` at all; a tag exists but
 * does not contain the merge commit; the first tag that DOES contain it is
 * a different version; and the resolved tag misses a different local PR
 * entirely. The third is the one a plain `--contains | head -1` without a
 * version sort would pass silently; the fifth is the one picking the tag by
 * PR NUMBER rather than `mergedAt` would pass silently, one level down.
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

/**
 * One local PR {@link releaseTag} must account for — its merge commit (or
 * `''` where the host answered none), when it merged, and the `vX.Y.Z` tags
 * containing that commit.
 */
export interface ReleaseTagPrRow {
  /** The PR number, as {@link releasePr} named it. */
  readonly number: number;
  /** That PR's merge commit sha, or `''` where the host answered none. */
  readonly mergeCommit: string;
  /** When it merged, ISO-8601, or `''` where the host answered none. */
  readonly mergedAt: string;
  /**
   * The `vX.Y.Z` tags containing {@link mergeCommit}, sorted oldest version
   * first — {@link Refs.tagsContaining}'s answer, read only once a merge
   * commit exists to ask about.
   */
  readonly containingTags: readonly string[];
}

/** What the caller read before asking. */
export interface ReleaseTagReading {
  /** One row per non-deferred local PR {@link releasePr} returned. */
  readonly prs: readonly ReleaseTagPrRow[];
  /** The version a release names, with or without its `v` prefix. */
  readonly wantedVersion: string;
}

/** The release tag resolved, or the refusal naming why it could not be. */
export type ReleaseTagResult =
  | { readonly outcome: 'resolved'; readonly tag: string }
  | {
      readonly outcome: 'refused';
      readonly reason: 'no-merge-commit' | 'no-tag' | 'tag-does-not-contain' | 'tag-mismatch' | 'tag-misses-pr';
      readonly detail: string;
    };

/** `v<version>` with any existing `v`/`V` prefix stripped first, matching the shell's normalisation. */
const asTag = (version: string): string => `v${version.replace(/^[Vv]/, '')}`;

/**
 * Resolves the tag that shipped a plan's merge commits, and checks it against
 * the version a release names.
 *
 * The tag is resolved from whichever row merged LAST, by `mergedAt` — never
 * by PR number, which would reproduce the same-repo mis-ordering this wave
 * exists to fix. Once resolved, every OTHER row's merge commit must also sit
 * in that tag's containing set, or the release is refused `tag-misses-pr`:
 * a tag naming only the latest-merged PR is not a tag that shipped the plan.
 *
 * @param reading - the local PRs (merge commit, merge time, containing tags) and the wanted version.
 * @returns the resolved tag, or a refusal naming which gate fired.
 */
export const releaseTag = (reading: ReleaseTagReading): ReleaseTagResult => {
  if (reading.prs.length === 0) {
    return {
      outcome: 'refused',
      reason: 'no-merge-commit',
      detail: 'names no \'→ #N\' annotation on a slice that was not deferred — the version cannot be resolved from a merge commit that does not exist.',
    };
  }

  const noCommit = reading.prs.find((pr) => pr.mergeCommit === '');
  if (noCommit !== undefined) {
    return {
      outcome: 'refused',
      reason: 'no-merge-commit',
      detail: `its last PR (#${noCommit.number}) carries no mergeCommit — it may not have merged, or the host could not answer.`,
    };
  }

  const lastPr = reading.prs.reduce((latest, pr) => (pr.mergedAt > latest.mergedAt ? pr : latest));
  const wanted = asTag(reading.wantedVersion);
  const firstTag = lastPr.containingTags[0];

  if (firstTag === undefined) {
    return {
      outcome: 'refused',
      reason: 'no-tag',
      detail: `no 'v*.*.*' tag contains the merge commit (${lastPr.mergeCommit}, from PR #${lastPr.number}).`,
    };
  }
  if (!lastPr.containingTags.includes(wanted)) {
    return {
      outcome: 'refused',
      reason: 'tag-does-not-contain',
      detail: `tag '${wanted}' does not contain the merge commit (${lastPr.mergeCommit}, from PR #${lastPr.number}). The tags that do: ${lastPr.containingTags.join(' ')}`,
    };
  }
  if (firstTag !== wanted) {
    return {
      outcome: 'refused',
      reason: 'tag-mismatch',
      detail: `shipped in '${firstTag}', not '${wanted}' — '${firstTag}' is the FIRST tag (by version) containing the merge commit (${lastPr.mergeCommit}, from PR #${lastPr.number}).`,
    };
  }

  const missed = reading.prs.find((pr) => pr.number !== lastPr.number && !pr.containingTags.includes(wanted));
  if (missed !== undefined) {
    return {
      outcome: 'refused',
      reason: 'tag-misses-pr',
      detail: `tag '${wanted}' does not contain PR #${missed.number}'s merge commit (${missed.mergeCommit}) — the first tag that does: ${missed.containingTags[0] ?? 'none'}.`,
    };
  }

  return { outcome: 'resolved', tag: wanted };
};
