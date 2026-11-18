import type { CiBuildMap, CiMapEntry } from './ci-build-map.js';

/** One branch's check as bound to its head commit. */
export interface CiBoundChecks {
  readonly checks: string;
  readonly job: string;
  readonly checksSha: string;
}

/** What the CI read answered for one listing pass. */
export interface CiBuildReading {
  /** The branch-colour map's status; anything but `ok` reads every row `unknown`. */
  readonly status: CiBuildMap['status'];
  /** The branch-colour map. */
  readonly map: Readonly<Record<string, CiMapEntry>>;
  /** Each named row's check as bound to its head commit, keyed by branch; null where nothing was read by commit. */
  readonly bound: Readonly<Record<string, CiBoundChecks>> | null;
  /** The branches the bind step named this pass, whether or not their lookup answered. */
  readonly named: readonly string[];
}

/** The listing row fields the projection reads. */
export interface CiBuildRowHead {
  /** The row's head branch. */
  readonly head: string;
  /** The row's head commit, or `''`. */
  readonly headSha: string;
  /** True for an open row: only an open row can be named past the cap or lose its lookup. */
  readonly open: boolean;
}

/** The fields the CI read sets on a row. */
export interface CiBuildFields {
  readonly checks: string;
  readonly checksSha: string;
  readonly failing_checks: readonly string[];
  /** Why an ambiguous row got no answer this pass; absent where it did or needed none. */
  readonly checksLookup?: 'broken' | 'skipped';
}

/** How an arm reads a row whose lookup was named and did not answer. */
export type CiBuildArm = 'broken-lookup' | 'colour-stands';

const checkedAmbiguous = (entry: CiMapEntry | undefined): boolean => entry?.checks === 'green' || entry?.checks === 'failing';

/**
 * Projects one listing row onto the `checks` fields the CI read sets.
 *
 * A declared duplicate of the `jq` projection in `plot-host.sh` (`_bb_jen_bind`
 * for the Bitbucket arm, the GitHub arm's `$eff` for the other), held to it by
 * the listing corpus tests. A colour that is `green` or `failing` belongs to
 * the branch's last build, not to the row's head, so it stands only where a
 * commit-bound answer exists or the row needed none. A row past the cap reads
 * `unknown` with `checksLookup: 'skipped'`. Where the lookup of a named row did
 * not answer, the `broken-lookup` arm reads `unknown` with `checksLookup:
 * 'broken'` and the `colour-stands` arm lets the colour stand.
 *
 * @param row - the row's branch, head commit and openness.
 * @param reading - what the CI read answered.
 * @param arm - how a named row with no answer reads.
 * @returns the fields to merge onto the row.
 */
export const ciBuildFields = (row: CiBuildRowHead, reading: CiBuildReading, arm: CiBuildArm): CiBuildFields => {
  const colour = reading.map[row.head];
  const ambiguous = checkedAmbiguous(colour);
  const named = reading.named.includes(row.head);
  const hasSha = row.headSha !== '';
  const lacksAnswer = reading.bound?.[row.head] === undefined;
  const past = ambiguous && hasSha && !named && (arm === 'colour-stands' || row.open);
  const broken = arm === 'broken-lookup' && row.open && ambiguous && named && lacksAnswer;
  const bound = reading.bound?.[row.head];
  const entry: { checks: string; job: string; checksSha: string } | null =
    bound !== undefined
      ? bound
      : past || broken
        ? null
        : colour === undefined
          ? null
          : { checks: colour.checks, job: colour.job, checksSha: '' };
  const checks =
    reading.status !== 'ok' ? 'unknown' : entry === null ? (ambiguous ? 'unknown' : 'none') : entry.checks;
  const lookup: 'broken' | 'skipped' | null =
    reading.status === 'ok' && entry === null ? (broken ? 'broken' : past ? 'skipped' : null) : null;
  return {
    checks,
    checksSha: entry?.checksSha ?? '',
    failing_checks: entry !== null && entry.checks === 'failing' ? [entry.job] : [],
    ...(lookup === null ? {} : { checksLookup: lookup }),
  };
};
