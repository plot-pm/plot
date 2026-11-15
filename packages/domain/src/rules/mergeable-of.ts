/**
 * The mergeability fields a pull request carries. GraphQL names `mergeable`
 * (`MERGEABLE`, `CONFLICTING`, `UNKNOWN`) and `mergeStateStatus`; REST's
 * single-PR payload names `mergeable` (true, false, null) and `mergeable_state`.
 */
export interface MergeableFields {
  readonly mergeable?: unknown;
  readonly mergeStateStatus?: unknown;
  readonly mergeable_state?: unknown;
}

/** One pull request's mergeability word. */
export type MergeableWord = 'conflicting' | 'mergeable' | 'unknown';

/**
 * The mergeability word for one pull request: `plot-host.sh`'s jq function
 * `mergeable_of` in `MERGEABLE_OF`, a declared duplicate held by
 * `corpus/checks-of.corpus.test.ts`.
 *
 * @param pr - the pull request's mergeability fields.
 * @returns `conflicting` for `CONFLICTING`, `false`, `DIRTY` or `dirty`;
 *   `mergeable` for `MERGEABLE` or `true`; `unknown` otherwise.
 */
export const mergeableOf = (pr: MergeableFields): MergeableWord => {
  if (pr.mergeable === 'CONFLICTING' || pr.mergeable === false || pr.mergeStateStatus === 'DIRTY' || pr.mergeable_state === 'dirty') {
    return 'conflicting';
  }
  return pr.mergeable === 'MERGEABLE' || pr.mergeable === true ? 'mergeable' : 'unknown';
};
