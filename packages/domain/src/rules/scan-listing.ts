import { extractHostNotices } from './pr-status.js';
import { sinceWatermark } from './known-pr.js';

/** One GitHub PR row as the host's plain or rich `pr-list` JSON carries it. */
export interface ScanListingRow {
  /** The branch the PR is opened from — `plot-host.sh`'s `head` field. */
  head: string;
  /** The PR's state word, as the host reports it (`OPEN`, `MERGED`, or another). */
  state: string;
  /** The host's own last-updated stamp for the PR, ISO-8601. */
  updatedAt: string;
  /** The checks rollup, where the `--rich` response carried one. */
  checks?: string;
  /** Whether the PR is a draft, where the `--rich` response carried one. */
  draft?: boolean;
}

/** The last whole listing `scanOnce` carried forward from an earlier pass. */
export interface CarriedListing {
  /** The rows of the last whole listing. */
  rows: readonly ScanListingRow[];
  /** Whether that listing was whole (`.list-complete`), not merely arrived. */
  complete: boolean;
  /** When the full read that produced it last ran, epoch milliseconds. */
  fullReadAt: number | null;
}

/** What a scan listing read may ask the host for. */
export type ScanListingWindow = { kind: 'full' } | { kind: 'delta'; since: string };

/**
 * Decides whether a scan listing read may narrow against the carried
 * listing, or must ask the host for everything.
 *
 * **A SIBLING OF {@link import('./pr-index.js').prWindowFor} AND
 * {@link import('./known-pr.js').mergedSetWindowFor}, NOT A CALL TO EITHER.**
 * All three answer *full or delta*, and all three refuse to a missing or
 * incomplete carried answer. This one takes no index row and no persisted
 * watermark: the watermark is the carried listing's own rows' newest
 * `updatedAt`, recomputed every time, because `scanOnce` persists no field for
 * it (the plan's own instruction — see `scan-listing.ts`'s module doc).
 *
 * @param held - the carried listing, or null where none is held yet.
 * @param now - this machine's clock, in epoch milliseconds.
 * @param fullReadMs - how long a delta may run before a full read is due.
 * @returns `full` where the carried listing cannot be narrowed against or the
 *   last full read is older than `fullReadMs`; `delta` with the `since` stamp
 *   otherwise.
 */
export const scanListingWindowFor = (
  held: CarriedListing | null,
  now: number,
  fullReadMs: number,
): ScanListingWindow => {
  const full: ScanListingWindow = { kind: 'full' };
  if (held === null) return full;
  if (!held.complete) return full;
  if (held.fullReadAt === null) return full;
  const watermark = newestUpdatedAt(held.rows);
  const since = sinceWatermark(watermark);
  if (since === null) return full;
  if (Math.abs(now - held.fullReadAt) >= fullReadMs) return full;
  return { kind: 'delta', since };
};

/**
 * The newest `updatedAt` among a listing's rows.
 *
 * @param rows - the listing's rows.
 * @returns the newest stamp that parses, or null where no row carries one.
 */
const newestUpdatedAt = (rows: readonly ScanListingRow[]): string | null =>
  rows.reduce<string | null>((newest, row) => {
    if (Number.isNaN(Date.parse(row.updatedAt))) return newest;
    if (newest === null) return row.updatedAt;
    return Date.parse(row.updatedAt) > Date.parse(newest) ? row.updatedAt : newest;
  }, null);

/**
 * Reads `plot-host.sh pr-list` stdout — one compact JSON object per line —
 * into {@link ScanListingRow}s.
 *
 * Reads `head`, `state` and `updatedAt` from every row. Reads `checks` and
 * `draft` only from a row that carries a `checks` string, which is the
 * `--rich` shape; a plain row gets neither, exactly as
 * `plot-fleet-scan.sh`'s `prefill_pr_states` fills `-` for both.
 *
 * @param stdout - the call's stdout.
 * @returns the rows, or null where a line is not JSON or a row carries no
 *   non-empty `head` or `state` string.
 */
export const parseScanListingRows = (stdout: string): ScanListingRow[] | null => {
  const rows: ScanListingRow[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let pr: Record<string, unknown>;
    try {
      pr = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (pr === null || typeof pr !== 'object') return null;
    const { head, state, updatedAt, checks, draft } = pr;
    if (typeof head !== 'string' || head === '') return null;
    if (typeof state !== 'string' || state === '') return null;
    const row: ScanListingRow = { head, state, updatedAt: typeof updatedAt === 'string' ? updatedAt : '' };
    if (typeof checks === 'string') {
      row.checks = checks;
      if (typeof draft === 'boolean') row.draft = draft;
    }
    rows.push(row);
  }
  return rows;
};

/**
 * Encodes a branch name the way `plot-fleet-scan.sh`'s `cache_key` does:
 * `_` to `__`, then `/` to `_`.
 *
 * @param branch - the branch name.
 * @returns the encoded key, or null where the name is not a non-empty string.
 */
export const encodeListingKey = (branch: unknown): string | null =>
  typeof branch === 'string' && branch !== ''
    ? branch.replace(/_/g, '__').replace(/\//g, '_')
    : null;

/**
 * Renders a listing into the shape `plot-fleet-scan.sh`'s `carried_listing`
 * reads: one `key<TAB>state<TAB>checks<TAB>draft` line per branch, `-` for an
 * absent checks or draft, then `.branches`, `.list-complete` where
 * `complete`, and `.list-arrived` last.
 *
 * Writes exactly four fields per line: `carried_listing` reads with
 * `read -r key st chk dft`, so a fifth field would land in `dft`.
 *
 * @param rows - the listing's rows.
 * @param complete - whether the listing is whole.
 * @returns the listing, or null where a row has no branch name to key it by.
 */
export const renderScanListing = (rows: readonly ScanListingRow[], complete: boolean): string | null => {
  const lines: string[] = [];
  for (const row of rows) {
    const key = encodeListingKey(row.head);
    if (key === null) return null;
    const draft = row.draft === undefined ? '-' : String(row.draft);
    lines.push(`${key}\t${row.state}\t${row.checks || '-'}\t${draft}\n`);
  }
  lines.push(`.branches\t${rows.length}\t-\t-\n`);
  if (complete) lines.push('.list-complete\t1\t-\t-\n');
  lines.push('.list-arrived\t1\t-\t-\n');
  return lines.join('');
};

/** One host answer to one `pr-list` call, read for the fold below. */
export interface ScanListingAnswer {
  /** Whether the call succeeded, and whether it claimed its page whole. */
  verdict: 'ok' | 'partial' | 'failed';
  /** The rows the call returned; empty where the call failed. */
  rows: readonly ScanListingRow[];
  /** The call's raw stderr, for the whole-page claim to be read from. */
  stderr: string | null;
}

/** Why a fold refused to produce a listing. */
export type ScanListingRefusal =
  | 'open-failed'
  | 'delta-failed'
  | 'no-whole-page-claim'
  | 'carried-incomplete'
  | 'open-row-vanished';

/** The result of folding a full-or-delta read over a carried listing. */
export type ScanListingFold =
  | { ok: true; rows: readonly ScanListingRow[]; complete: boolean }
  | { ok: false; refusal: ScanListingRefusal };

/**
 * Whether an answer is a whole page: an `ok` answer whose stderr claims its
 * page whole, or an `ok` answer with no rows, for which `plot-host.sh`'s
 * `pr_list_report_truncation` owes no claim.
 */
const wholePage = (answer: ScanListingAnswer): boolean =>
  answer.verdict === 'ok' && (answer.rows.length === 0
    || extractHostNotices(answer.stderr).notices.some((notice) =>
      /sweep complete|page complete|window complete/.test(notice.text)));

/**
 * Folds a full-read-or-delta-read pair of host responses over a carried
 * listing, ranking each branch's rows OPEN first, then MERGED, then anything
 * else — **a declared duplicate of `plot-fleet-scan.sh`'s `prefill_pr_states`
 * rank** (`docs/shell-and-domain.md`), held to a corpus test rather than a
 * shared implementation.
 *
 * Every carried OPEN row is dropped before folding — the new open call is
 * authoritative for OPEN, exactly as the shell's own full read drops the
 * `all` payload's OPEN rows. A carried OPEN row absent from both new answers'
 * rows is refused rather than kept: the delta's `since` window should have
 * caught any change to it, so its absence is doubt, not confirmation it is
 * still open.
 *
 * A page is whole where its stderr claims it whole, or where it answered `ok`
 * with no rows. A full read whose two pages both hold no rows is refused: an
 * empty answer is not evidence of a repository with no pull requests.
 *
 * `complete` is true for a full read, where both pages are whole, and for a
 * delta only where the carried listing was already complete; a carried
 * listing that was never whole cannot be made whole by folding.
 *
 * @param carried - the listing to fold onto, or null for a full read with
 *   nothing carried.
 * @param open - the `pr-list --state open --rich` answer, never narrowed by
 *   `--since`: it is authoritative for every OPEN row.
 * @param rest - the `pr-list --state all` (full) or `--state all --since`
 *   (delta) answer.
 * @returns the folded rows and completeness, or the refusal naming why a full
 *   read should be made instead.
 */
export const foldScanListing = (
  carried: CarriedListing | null,
  open: ScanListingAnswer,
  rest: ScanListingAnswer,
): ScanListingFold => {
  if (open.verdict === 'failed') return { ok: false, refusal: 'open-failed' };
  if (rest.verdict === 'failed') return { ok: false, refusal: 'delta-failed' };
  if (!wholePage(open) || !wholePage(rest)) {
    return { ok: false, refusal: 'no-whole-page-claim' };
  }
  if (carried === null && open.rows.length === 0 && rest.rows.length === 0) {
    return { ok: false, refusal: 'no-whole-page-claim' };
  }

  const carriedRows = carried?.rows ?? [];
  const carriedNonOpen = carriedRows.filter((row) => row.state !== 'OPEN');
  const newHeads = new Set([...open.rows, ...rest.rows].map((row) => row.head));
  const vanishedOpen = carriedRows.some((row) => row.state === 'OPEN' && !newHeads.has(row.head));
  if (vanishedOpen) return { ok: false, refusal: 'open-row-vanished' };

  const restNonOpen = rest.rows.filter((row) => row.state !== 'OPEN');
  const ranked = new Map<string, ScanListingRow>();
  for (const row of [...carriedNonOpen, ...restNonOpen, ...open.rows]) {
    const existing = ranked.get(row.head);
    if (existing === undefined || rank(row.state) < rank(existing.state)) ranked.set(row.head, row);
  }

  return { ok: true, rows: [...ranked.values()], complete: carried === null ? true : carried.complete };
};

/** OPEN first, then MERGED, then everything else — the shell's own rank. */
const rank = (state: string): number => {
  if (state === 'OPEN') return 1;
  if (state === 'MERGED') return 2;
  return 3;
};
