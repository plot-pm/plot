import type { PrListingCompleteness, PrListingRow } from '../ports/host.js';
import { sinceWatermark } from './known-pr.js';
import { refusalKind } from './refusal.js';

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
 * Reads listed PR rows into {@link ScanListingRow}s.
 *
 * Reads `head`, `state` and `updatedAt` from every row. Reads `checks` and
 * `draft` only from a row that carries a `checks` string, which is the
 * `--rich` shape; a plain row gets neither, exactly as
 * `plot-fleet-scan.sh`'s `prefill_pr_states` fills `-` for both.
 *
 * @param listed - the rows as the host listed them.
 * @returns the rows, or null where a row carries no non-empty `head` or
 *   `state` string.
 */
export const scanListingRowsOf = (listed: readonly PrListingRow[]): ScanListingRow[] | null => {
  const rows: ScanListingRow[] = [];
  for (const pr of listed) {
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
 * Reads `plot-host.sh pr-list` stdout — one compact JSON object per line —
 * into {@link ScanListingRow}s, as {@link scanListingRowsOf} reads each row.
 *
 * @param stdout - the call's stdout.
 * @returns the rows, or null where a line is not a JSON object or a row
 *   carries no non-empty `head` or `state` string.
 */
export const parseScanListingRows = (stdout: string): ScanListingRow[] | null => {
  const listed: PrListingRow[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let pr: unknown;
    try {
      pr = JSON.parse(line);
    } catch {
      return null;
    }
    if (pr === null || typeof pr !== 'object') return null;
    listed.push(pr as PrListingRow);
  }
  return scanListingRowsOf(listed);
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

/** A rendered listing read back: each branch key's PR state, and whether the listing is whole. */
export interface CarriedPrStates {
  /** The PR state word per branch, keyed by {@link encodeListingKey}. */
  states: ReadonlyMap<string, string>;
  /** Whether the listing carried `.list-complete`. */
  complete: boolean;
  /** Every branch line the listing carried, with its checks and draft words as written. */
  rows: readonly ReportedListingRow[];
}

/** One branch line of a listing the scan reports on stderr. */
export interface ReportedListingRow {
  /** The branch, encoded by {@link encodeListingKey}. */
  key: string;
  /** The PR state word. */
  state: string;
  /** The checks word, or `-` where the row carried none. */
  checks: string;
  /** The draft word, or `-` where the row carried none. */
  draft: string;
}

/**
 * Reads a listing that {@link renderScanListing} wrote back into PR states,
 * as `plot-fleet-scan.sh`'s `carried_listing` reads it.
 *
 * Skips every dotted key and every line with an empty state. Where two lines
 * name one key, the later line wins.
 *
 * @param listing - the rendered listing, one `key<TAB>state<TAB>checks<TAB>draft` line per branch.
 * @returns the states and completeness, or null where the listing is empty or
 *   carries no `.list-arrived` line.
 */
export const readCarriedPrStates = (listing: string): CarriedPrStates | null => {
  const states = new Map<string, string>();
  const rows = new Map<string, ReportedListingRow>();
  let arrived = false;
  let complete = false;
  for (const line of listing.split('\n')) {
    const [key = '', state = '', checks = '-', draft = '-'] = line.split('\t');
    if (key === '') continue;
    if (key === '.list-arrived') arrived = true;
    else if (key === '.list-complete') complete = true;
    else if (!key.startsWith('.') && state !== '') {
      states.set(key, state);
      rows.set(key, { key, state, checks: checks || '-', draft: draft || '-' });
    }
  }
  return arrived ? { states, complete, rows: [...rows.values()] } : null;
};

/**
 * Renders the `listing:` lines a scan prints on stderr for the board to carry:
 * `.branches` first, one line per branch in key order, `.list-complete` where
 * the listing was whole, and `.list-arrived` last so a cut listing carries none.
 *
 * @param rows - the listing's branch lines.
 * @param tracked - how many remote branches the listing swept.
 * @param complete - whether the listing was whole.
 * @returns the lines, each ending in a newline.
 */
export const renderListingReport = (rows: readonly ReportedListingRow[], tracked: number, complete: boolean): string => {
  const line = (key: string, a: string, b: string, c: string): string => `listing: ${key}\t${a}\t${b}\t${c}\n`;
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return (
    line('.branches', String(tracked), '-', '-') +
    sorted.map((r) => line(r.key, r.state, r.checks || '-', r.draft || '-')).join('') +
    (complete ? line('.list-complete', '1', '-', '-') : '') +
    line('.list-arrived', '1', '-', '-')
  );
};

/** One host answer to one `pr-list` call, read for the fold below. */
export interface ScanListingAnswer {
  /** Whether the call succeeded, and whether it claimed its page whole. */
  verdict: 'ok' | 'partial' | 'failed';
  /** The rows the call returned; empty where the call failed. */
  rows: readonly ScanListingRow[];
  /** Whether the host claimed the asked state's page whole. */
  complete: PrListingCompleteness;
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
 * Whether an answer is a whole page: an `ok` answer whose state reads `whole`,
 * or an `ok` answer with no rows, for which `plot-host.sh`'s
 * `pr_list_report_truncation` owes no claim.
 */
const wholePage = (answer: ScanListingAnswer): boolean =>
  answer.verdict === 'ok' && (answer.rows.length === 0 || answer.complete === 'whole');

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
 * A page is whole where its completeness word reads `whole`, or where it
 * answered `ok` with no rows. A full read whose two pages both hold no rows is refused: an
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

/** How one `pr-list` call of the scan's own listing read was answered. */
export type PulseListingVerdict = 'ok' | 'partial' | 'unasked' | 'secondary' | 'throttled' | 'failed';

/** One `pr-list` call of the scan's own listing read, as `Scripts.hostSaid` answered it. */
export interface PulseListingCall {
  /** `answered`, `partial` (exit 7, some states answered), `failed`, or `unaskable` (exit 4). */
  answer: 'answered' | 'partial' | 'failed' | 'unaskable';
  /** The call's stdout; `''` where it failed. */
  stdout: string;
  /** The call's stderr on an answer, or the host's sentence on a refusal. */
  said: string;
  /** The refusal the host named on a failed call, where it named one. */
  kind?: 'throttled' | 'secondary';
  /** Whether the host claimed the asked state's page whole. */
  complete: PrListingCompleteness;
}

/** The scan's own listing: the rows it holds, as a carried listing reads them, and how the host answered. */
export interface PulseListing {
  /** The worse of the two calls' verdicts. */
  verdict: PulseListingVerdict;
  /** The listing, or null where no call's rows may be used. */
  listing: CarriedPrStates | null;
  /** The host's sentence where the verdict is a refusal; `''` otherwise. */
  said: string;
}

/** The wordings a host CLI uses when it has no identity: the question was never put. */
const NO_IDENTITY: readonly RegExp[] = [/token/i, /auth/i, /login/i, /credential/i, /not logged/i, /no git remotes?/i, /no remote/i];

/** The verdicts from best to worst; the listing reports the worse of its two calls. */
const VERDICT_ORDER: readonly PulseListingVerdict[] = ['ok', 'partial', 'unasked', 'secondary', 'throttled', 'failed'];

/**
 * Reads one `pr-list` call's answer as a verdict: a spent quota is
 * `throttled`, a burst refusal `secondary`, a host with no identity or no such
 * capability `unasked`, and any other refusal `failed`. The refusal the host
 * named outranks what its sentence says.
 *
 * @param call - the call.
 * @returns the verdict.
 */
export const pulseListingVerdict = (call: PulseListingCall): PulseListingVerdict => {
  if (call.answer === 'answered') return 'ok';
  if (call.answer === 'partial') return 'partial';
  if (call.answer === 'unaskable') return 'unasked';
  if (call.kind !== undefined) return call.kind;
  const kind = refusalKind(call.said);
  if (kind === 'quota') return 'throttled';
  if (kind === 'secondary') return 'secondary';
  return NO_IDENTITY.some((pattern) => pattern.test(call.said)) ? 'unasked' : 'failed';
};

/** The rows of a `pr-list` payload; a line that is not a PR row is skipped, as the shell scan's `sed` skipped it. */
const pulseRows = (stdout: string): ScanListingRow[] =>
  stdout.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    const rows = parseScanListingRows(line);
    return rows === null ? [] : rows;
  });

/**
 * Folds the scan's own two `pr-list` calls into one listing: `--state open
 * --rich`, then `--state settled`, the second asked only where the first
 * answered.
 *
 * THE SHELL SCAN'S `prefill_pr_states`, moved. The verdict is the worse of
 * the two. A refusal yields no listing; a partial answer keeps the rows that
 * arrived. The settled payload's OPEN rows are dropped, so an open PR keeps
 * the rich row's checks and draft words, and one row per branch is kept:
 * OPEN, then MERGED, then any other state, the first of a rank where two tie.
 *
 * THE LISTING IS COMPLETE only where the open call answered in full and either
 * both calls' pages read `whole`, or, with no claim, the settled
 * payload holds at least one row and each payload holds fewer rows than
 * `limit`. A page at its limit with no claim may be truncated, so it licenses
 * nothing.
 *
 * @param open - the open call.
 * @param settled - the settled call, or null where it was not asked.
 * @param limit - the `--limit` both calls were asked with.
 * @returns the verdict and the listing.
 */
export const foldPulseListing = (open: PulseListingCall, settled: PulseListingCall | null, limit: number): PulseListing => {
  const calls = settled === null ? [open] : [open, settled];
  const verdicts = calls.map(pulseListingVerdict);
  const worst = verdicts.reduce((a, b) => (VERDICT_ORDER.indexOf(b) > VERDICT_ORDER.indexOf(a) ? b : a));
  if (settled === null || (worst !== 'ok' && worst !== 'partial')) {
    const refused = calls.find((_call, i) => verdicts[i] === worst)!;
    return { verdict: worst, listing: null, said: refused.said };
  }
  const openRows = pulseRows(open.stdout);
  const settledRows = pulseRows(settled.stdout);
  const kept = new Map<string, ScanListingRow>();
  for (const row of [...openRows, ...settledRows.filter((r) => r.state !== 'OPEN')]) {
    const held = kept.get(row.head);
    if (held === undefined || rank(row.state) < rank(held.state)) kept.set(row.head, row);
  }
  const complete = verdicts[0] === 'ok'
    && ((open.complete === 'whole' && settled.complete === 'whole')
      || (settledRows.length > 0 && settledRows.length < limit && openRows.length < limit));
  return { verdict: worst, listing: readCarriedPrStates(renderScanListing([...kept.values()], complete)!), said: '' };
};
