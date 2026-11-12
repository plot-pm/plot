import type { PrIndexRow } from '../entities/pr-index.js';
import { readCarriedPrStates } from './scan-listing.js';
import type { StaleReading } from './snapshot-stale.js';

/** Why a scan starts. */
export type ScanReason = 'unwatched' | 'safety-net' | 'degraded' | 'pending';

/** What a scan reads: every reading, or the named ones and the held rest. */
export type ScanTrigger =
  | { run: false }
  | {
      run: true;
      reason: ScanReason;
      /** Whether the walk runs `git fetch --prune` first. */
      fetch: boolean;
      /** Whether the PR listing is due whatever its own cadence says. */
      listing: boolean;
      /** The readings to read again; `'all'` reads every one. */
      readings: 'all' | readonly StaleReading[];
    };

/** A scan that starts. */
export type ScanPlan = Extract<ScanTrigger, { run: true }>;

/** What {@link scanTrigger} decides from. */
export interface ScanTriggerInput {
  /** Whether fleetd arms a watch set; `false` reads every beat, as a process with no watches must. */
  watched: boolean;
  /** The readings pending, in the order they were named. */
  pending: readonly StaleReading[];
  /** Whether a `remote` change or the safety net is among the pending changes. */
  remotePending: boolean;
  /** Directories armed and not degraded. */
  armed: number;
  /** Directories wanted. */
  wanted: number;
  /** Whether the safety net is due (`safetyNetDue`). */
  safetyNetDue: boolean;
}

/**
 * Decides whether a beat starts a scan, and what the scan reads.
 *
 * A scan starts on a non-empty pending set, a degraded watch (`armed <
 * wanted`) or a due safety net, and on every beat where fleetd arms no watch
 * set. A due safety net and a degraded watch read every reading and fetch; a
 * pending set reads the readings it names, and fetches only where a `remote`
 * change is among them.
 *
 * @param input - the beat's readings.
 * @returns the decision; `{ run: false }` starts nothing.
 */
export const scanTrigger = (input: ScanTriggerInput): ScanTrigger => {
  if (!input.watched) return { run: true, reason: 'unwatched', fetch: true, listing: true, readings: 'all' };
  if (input.safetyNetDue) return { run: true, reason: 'safety-net', fetch: true, listing: true, readings: 'all' };
  if (input.armed < input.wanted) return { run: true, reason: 'degraded', fetch: true, listing: true, readings: 'all' };
  if (input.pending.length === 0) return { run: false };
  return {
    run: true,
    reason: 'pending',
    fetch: input.remotePending,
    listing: input.pending.some((reading) => reading.key === 'prs'),
    readings: input.pending,
  };
};

/** The pull requests a read names, by head and state. */
interface Row {
  head: string;
  state: string;
  content: string;
}

const verdict = (rows: readonly Row[], before: readonly Row[]): { remote: boolean; prs: boolean } => {
  const was = new Map(before.map((row) => [row.head, row]));
  const now = new Map(rows.map((row) => [row.head, row]));
  let remote = [...was.keys()].some((head) => !now.has(head)) || [...now.keys()].some((head) => !was.has(head));
  let prs = false;
  for (const [head, row] of now) {
    const prior = was.get(head);
    if (prior === undefined) continue;
    if (row.state === 'MERGED' && prior.state !== 'MERGED') remote = true;
    if (row.content !== prior.content) prs = true;
  }
  return { remote, prs: prs || remote };
};

/**
 * Names what a new PR listing changed against the one held.
 *
 * `remote` is true where a head branch appeared or went away, or a PR newly
 * reads `MERGED`: each moves a ref on the remote. A CI, review or draft change
 * is `prs` alone. The listing carries no default-branch head, so a push to the
 * default branch with no PR is the safety net's to find.
 *
 * @param before - the rendered listing held; `''` where none is.
 * @param after - the rendered listing just read.
 * @returns both flags false where either listing is unreadable or `before` is empty.
 */
export const listingChange = (before: string, after: string): { remote: boolean; prs: boolean } => {
  const was = readCarriedPrStates(before);
  const now = readCarriedPrStates(after);
  if (was === null || now === null) return { remote: false, prs: false };
  const rowsOf = (carried: NonNullable<typeof was>): Row[] =>
    carried.rows.map((row) => ({ head: row.key, state: row.state, content: `${row.state}\t${row.checks}\t${row.draft}` }));
  return verdict(rowsOf(now), rowsOf(was));
};

/**
 * Names what the PR index's rows changed between two reads, the same way {@link listingChange} reads a listing.
 *
 * @param before - the rows held before the PR pass.
 * @param after - the rows after it.
 * @returns the change; a CI, review or draft change is `prs` alone.
 */
export const indexChange = (before: readonly PrIndexRow[], after: readonly PrIndexRow[]): { remote: boolean; prs: boolean } => {
  const rowsOf = (rows: readonly PrIndexRow[]): Row[] =>
    rows.map((row) => ({ head: row.head, state: row.state, content: `${row.state}\t${row.checks}\t${row.review}\t${row.draft}` }));
  return verdict(rowsOf(after), rowsOf(before));
};

/** The desk reads a scan takes again. */
export interface DeskReads {
  /** The desks whose git status is read again, by path; `'all'` reads every desk. */
  status: 'all' | ReadonlySet<string>;
  /** Whether every desk's unpushed commits are read again: a ref moved, and a push moves none of the desk's own files. */
  unpushed: boolean;
}

/**
 * Names the desk reads a scan takes again.
 *
 * A reading of `desks` with no desk, or a scan that reads everything, names
 * every desk. Otherwise only the desks the readings name are read again, and
 * every desk's unpushed commits are read again where `refs` is named.
 *
 * @param readings - what the scan reads, from {@link ScanPlan}.
 * @returns the desk reads.
 */
export const deskReadsOf = (readings: ScanPlan['readings']): DeskReads => {
  if (readings === 'all') return { status: 'all', unpushed: true };
  const unpushed = readings.some((reading) => reading.key === 'refs');
  if (readings.some((reading) => reading.key === 'desks' && reading.desk === undefined)) return { status: 'all', unpushed };
  return { status: new Set(readings.flatMap((reading) => (reading.key === 'desks' && reading.desk !== undefined ? [reading.desk] : []))), unpushed };
};
