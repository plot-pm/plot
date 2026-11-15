import { jqOr } from './checks-of.js';

/** One pull request as Bitbucket's `pullrequests` endpoint exports it, for the fields `pr-list` reads. */
export interface BitbucketPullRequest {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly state?: unknown;
  readonly draft?: unknown;
  readonly updated_on?: unknown;
  readonly links?: { readonly html?: { readonly href?: unknown } | null } | null;
  readonly author?: { readonly nickname?: unknown } | null;
  readonly source?: {
    readonly branch?: { readonly name?: unknown } | null;
    readonly commit?: { readonly hash?: unknown } | null;
  } | null;
  readonly destination?: { readonly branch?: { readonly name?: unknown } | null } | null;
}

/** One `pr-list` row of a Bitbucket listing: every field the projection writes, by name. */
export type BitbucketPrRow = Readonly<Record<string, unknown>>;

/** The value a field jq reads from a missing key: `null`. */
const field = (value: unknown): unknown => (value === undefined ? null : value);

/** The state word of a row: Bitbucket's `DECLINED` is the adapter's `CLOSED`. */
const stateOf = (pr: BitbucketPullRequest): unknown => (pr.state === 'DECLINED' ? 'CLOSED' : field(pr.state));

/**
 * The plain `pr-list` row: the projection of `plot-host.sh`'s plain Bitbucket
 * arm, a declared duplicate held by `corpus/bitbucket-pr-listing.corpus.test.ts`.
 *
 * `mergedAt` is `updated_on` for a `MERGED` row, because Bitbucket records no
 * merge time of its own, and `''` for every other state. `base` names the
 * destination branch and is the input of the mergeability reading.
 *
 * @param pr - the pull request as Bitbucket exports it.
 * @returns `number`, `title`, `state`, `head`, `draft`, `url`, `updatedAt`,
 *   `headSha`, `mergedAt`, `author` and `base`; the last five `''` where absent.
 */
export const bitbucketPlainRow = (pr: BitbucketPullRequest): BitbucketPrRow => ({
  number: field(pr.id),
  title: field(pr.title),
  state: stateOf(pr),
  head: field(pr.source?.branch?.name),
  draft: jqOr(pr.draft, false),
  url: jqOr(pr.links?.html?.href, ''),
  updatedAt: jqOr(pr.updated_on, ''),
  headSha: jqOr(pr.source?.commit?.hash, ''),
  mergedAt: pr.state === 'MERGED' ? jqOr(pr.updated_on, '') : '',
  author: jqOr(pr.author?.nickname, ''),
  base: jqOr(pr.destination?.branch?.name, ''),
});

/**
 * The rich `pr-list` row of a Bitbucket repository with no CI connector: the
 * plain row with the standing answers Bitbucket gives for what it cannot say,
 * `checks` `unknown`, `mergeable` `unknown`, `review` `''` and
 * `failing_checks` empty. The mergeability fold replaces `mergeable` on an
 * open row.
 *
 * @param pr - the pull request as Bitbucket exports it.
 * @returns the rich row, still carrying `base`.
 */
export const bitbucketRichRow = (pr: BitbucketPullRequest): BitbucketPrRow => {
  const plain = bitbucketPlainRow(pr);
  return {
    number: plain.number,
    title: plain.title,
    state: plain.state,
    head: plain.head,
    draft: plain.draft,
    checks: 'unknown',
    mergeable: 'unknown',
    review: '',
    url: plain.url,
    updatedAt: plain.updatedAt,
    headSha: plain.headSha,
    mergedAt: plain.mergedAt,
    author: plain.author,
    failing_checks: [],
    base: plain.base,
  };
};
