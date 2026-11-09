import type { PrIndexRow } from '../entities/pr-index.js';

/** One PR as the host adapter reports it, collapsed to what the board's rows need. */
export interface PrRecord {
  number: number;
  head: string;
  /** OPEN · MERGED · CLOSED, as the adapter normalizes it. */
  state: string;
  draft: boolean;
  /** green · pending · failing · none · unknown — see plot-host.sh pr-list --rich. */
  checks: string;
  /**
   * mergeable · conflicting · unknown — see plot-host.sh pr-list --rich.
   * Absent where the host gave no answer; absent never means mergeable.
   */
  mergeable?: string;
  /** APPROVED · CHANGES_REQUESTED · REVIEW_REQUIRED · "" — informational only. */
  review: string;
  /** The names of the failing checks; absent where the host named none. */
  failing_checks?: string[];
  /** The PR's web page. */
  url: string;
  /** The host's last-update time; absent where the host gave none. */
  updatedAt?: string;
  /** The PR author's login; absent where the host gave none. */
  author?: string;
  /** The head commit the host answered, or absent; never `''` in the store. */
  headSha?: string;
  /** When the fold first saw `headSha`, this machine's clock; set by `storeRow`. */
  headSince?: string;
  /** The commit `checks` was computed for; the rollup arm only. */
  checksSha?: string;
  /** Why the checks lookup gave no rollup: `skipped` or `broken`; absent where it gave one. */
  checksLookup?: 'skipped' | 'broken';
  /** The host's merge time; absent on an open PR. */
  mergedAt?: string;
  /** The `plot/review` status context's state; the GitHub rollup arm only. */
  plotReview?: 'success' | 'failure' | 'pending' | 'error' | 'absent';
  /** The commit the rollup named for `plot/review`; absent where `plotReview` is. */
  plotReviewSha?: string;
  /** The `plot/review` status context's `startedAt`; absent where `plotReview` is. */
  plotReviewAt?: string;
  /** The writer check's state for `plotReviewCheckedSha`; see the row field. */
  plotReviewJudged?: 'success' | 'failure' | 'pending' | 'absent' | 'error';
  /** The head `plotReviewJudged` read. */
  plotReviewCheckedSha?: string;
  /** The rollup's `plotReviewAt` when the judgment was made. */
  plotReviewCheckedAt?: string;
  /** `checks` folded with `plot/review` excluded; the GitHub rollup arm only. */
  ciChecks?: 'green' | 'pending' | 'failing' | 'none' | 'unknown';
}

const OPTIONAL_FIELDS = [
  'mergeable',
  'failing_checks',
  'updatedAt',
  'author',
  'headSha',
  'headSince',
  'checksSha',
  'checksLookup',
  'mergedAt',
  'plotReview',
  'plotReviewSha',
  'plotReviewAt',
  'ciChecks',
  'plotReviewJudged',
  'plotReviewCheckedSha',
  'plotReviewCheckedAt',
] as const satisfies ReadonlyArray<keyof PrRecord & keyof PrIndexRow>;

/**
 * One stored PR index row in the shape the board's maps hold.
 *
 * @param row - the row as the store holds it.
 * @returns the record. A field the row omits is absent from the record too.
 */
export const prRecordOf = (row: PrIndexRow): PrRecord => {
  const pr: PrRecord = {
    number: row.number,
    head: row.head,
    state: row.state,
    draft: row.draft,
    checks: row.checks,
    review: row.review,
    url: row.url,
  };
  for (const field of OPTIONAL_FIELDS) {
    if (row[field] !== undefined) Object.assign(pr, { [field]: row[field] });
  }
  return pr;
};

/**
 * Whether one PR outranks another for the same head branch.
 *
 * @param candidate - the PR that might replace the held one.
 * @param held - the PR held now.
 * @returns true where only the candidate is open, or where both or neither are
 *   open and the candidate's number is higher.
 */
export const prOutranks = (candidate: PrRecord, held: PrRecord): boolean => {
  const open = (pr: PrRecord) => pr.state === 'OPEN';
  if (open(candidate) !== open(held)) return open(candidate);
  return candidate.number > held.number;
};

/** The three maps the board serves, derived from one set of rows. */
export interface PrMaps {
  /** Open PRs by head branch — what `classify` reads. */
  prs: Map<string, PrRecord>;
  /** Every PR by number, whatever its state. */
  byNumber: Map<number, PrRecord>;
  /** One PR per head branch, ranked by {@link prOutranks}; every state, for the link. */
  byHead: Map<string, PrRecord>;
}

/**
 * Builds the three served maps from stored rows.
 *
 * @param rows - the rows to derive from, as the store holds them.
 * @returns the maps. A row with an empty head is in `byNumber` only.
 */
export const mapsOfRows = (rows: readonly PrIndexRow[]): PrMaps => {
  const prs = new Map<string, PrRecord>();
  const byNumber = new Map<number, PrRecord>();
  const byHead = new Map<string, PrRecord>();
  for (const row of rows) {
    const pr = prRecordOf(row);
    if (pr.head && pr.state === 'OPEN') prs.set(pr.head, pr);
    byNumber.set(pr.number, pr);
    if (pr.head) {
      const ranked = byHead.get(pr.head);
      if (!ranked || prOutranks(pr, ranked)) byHead.set(pr.head, pr);
    }
  }
  return { prs, byNumber, byHead };
};
