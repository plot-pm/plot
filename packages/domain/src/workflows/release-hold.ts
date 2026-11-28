import type { PortResult } from '../port-result.js';
import type { PrIndexRow } from '../entities/pr-index.js';
import { RELEASE_HOLD_PERSON_VERSION, type ReleaseHoldPersonRecord } from '../entities/release-hold-person.js';
import type { ReleaseHoldPersonStore } from '../ports/release-hold-person.js';
import type { ReleaseHeadReading } from '../rules/release-head.js';
import { holdClock, releasePersonHold, releaseRowOf } from '../rules/release-hold-person.js';
import { releaseHoldable, type ReleaseHoldable } from '../rules/release-prepare.js';
import { sameCommit } from '../rules/same-commit.js';
import type { Caller } from './decision.js';

/** Why a hold or a lift refused. Each is the end of the action: nothing is written. */
export type ReleaseHoldRefusal =
  | 'unattended'
  | 'unaskable'
  | 'no-release-pr'
  | 'head-moved'
  | 'already-held'
  | 'nothing-held'
  | 'head-not-held'
  | Exclude<ReleaseHoldable, 'holdable'>;

/** What a hold or a lift answers, as one JSON line. */
export type ReleaseHoldResult =
  | { readonly ok: true; readonly act: 'hold' | 'lift'; readonly pr: number; readonly head: string; readonly at: string; readonly end?: string }
  | { readonly ok: false; readonly reason: ReleaseHoldRefusal; readonly detail: string };

/** The ports a hold or a lift needs. */
export interface ReleaseHoldPorts {
  /** Who asks; an unattended caller is refused before any read. */
  readonly caller: Caller;
  /** The person's name the record carries as `by`. */
  readonly who: string;
  /** The person hold's file. */
  readonly store: ReleaseHoldPersonStore;
  /** The PR index rows of the git host's connector; `answered(null)` where no index exists. */
  readonly rows: () => Promise<PortResult<readonly PrIndexRow[] | null>>;
  /** The default branch's name. */
  readonly defaultBranchName: () => Promise<PortResult<string>>;
  /** What a head changes against its merge base; absent or `null` reads as unread. */
  readonly headChanges?: (sha: string) => Promise<ReleaseHeadReading | null>;
  /** The hold's length, `Checks wait`, in milliseconds. */
  readonly checksWaitMs: number;
  /** The clock, as epoch milliseconds. */
  readonly now: () => number;
}

const no = (reason: ReleaseHoldRefusal, detail: string): ReleaseHoldResult => ({ ok: false, reason, detail });

const short = (sha: string | undefined): string => (sha === undefined || sha === '' ? 'none' : sha.slice(0, 12));

const UNATTENDED = 'an unattended caller does not hold or lift merges. The hold is a person\'s act, and this caller is no person.';

/**
 * Holds merges into the default branch for the release head `sha`, or refuses.
 *
 * Reads, in order: the caller, the PR index rows, the default branch's name,
 * the record, the head's changes and {@link releaseHoldable}. It refuses
 * `already-held` while a hold holds, so a second press does not move `at`.
 * On a pass it writes `{ pr, act: 'hold', head, at, by }` as one whole file.
 *
 * @param ports - the hold's ports.
 * @param sha - the release head the person read.
 * @returns the hold with its end, or the refusal naming its reason.
 */
export const releaseHoldAt = async (ports: ReleaseHoldPorts, sha: string): Promise<ReleaseHoldResult> => {
  if (ports.caller === 'unattended') return no('unattended', UNATTENDED);
  const rows = await ports.rows();
  if (!rows.ok) return no('unaskable', 'the PR index could not be read. Nothing was written.');
  const name = await ports.defaultBranchName();
  if (!name.ok) return no('unaskable', 'the default branch\'s name could not be read. Nothing was written.');
  const row = releaseRowOf(rows.value ?? [], name.value);
  if (row === null) return no('no-release-pr', `the PR index holds no open release PR into ${name.value}. Nothing was written.`);
  if (row.headSha === undefined || !sameCommit(row.headSha, sha)) {
    return no('head-moved', `the head of release PR #${row.number} is ${short(row.headSha)}; the caller read ${short(sha)}. Read the new head, then ask again.`);
  }
  const record = await ports.store.read();
  if (!record.ok) return no('unaskable', 'the person hold file could not be read. Nothing was written.');
  const now = ports.now();
  const held = releasePersonHold(rows.value ?? [], record.value, name.value, now, ports.checksWaitMs);
  if (held.holds) {
    return no('already-held', `release #${held.pr} already holds merges until ${holdClock(held.end)}. A second hold does not extend it.`);
  }
  const changes = ports.headChanges === undefined ? null : await ports.headChanges(row.headSha);
  const holdable = releaseHoldable(row, changes, name.value);
  if (holdable !== 'holdable') {
    return no(holdable, `release PR #${row.number} at ${short(row.headSha)} is not holdable: ${holdable}. Nothing was written.`);
  }
  const at = new Date(now).toISOString();
  const next: ReleaseHoldPersonRecord = { v: RELEASE_HOLD_PERSON_VERSION, pr: row.number, act: 'hold', head: row.headSha, at, by: ports.who };
  const wrote = await ports.store.write(next);
  if (!wrote.ok) return no('unaskable', 'the person hold file could not be written. Nothing holds.');
  return { ok: true, act: 'hold', pr: row.number, head: row.headSha, at, end: new Date(now + ports.checksWaitMs).toISOString() };
};

/**
 * Lifts the person hold on the head `sha`, or refuses.
 *
 * Reads the caller, then the record. A record that is no hold refuses
 * `nothing-held`; a hold on another head refuses `head-not-held` and leaves
 * that hold in place. On a pass it writes `act: 'lift'` naming the hold's head.
 *
 * @param ports - the hold's ports; `rows`, `defaultBranchName` and `headChanges` are not read.
 * @param sha - the head the person lifts the hold on.
 * @returns the lift, or the refusal naming its reason.
 */
export const releaseHoldLiftAt = async (ports: ReleaseHoldPorts, sha: string): Promise<ReleaseHoldResult> => {
  if (ports.caller === 'unattended') return no('unattended', UNATTENDED);
  const record = await ports.store.read();
  if (!record.ok) return no('unaskable', 'the person hold file could not be read. Nothing was written.');
  const held = record.value;
  if (held === null || held.act !== 'hold') return no('nothing-held', 'the person hold file names no hold. Nothing was written.');
  if (!sameCommit(held.head, sha)) {
    return no('head-not-held', `the hold names head ${short(held.head)}; the caller named ${short(sha)}. The hold stays; nothing was written.`);
  }
  const at = new Date(ports.now()).toISOString();
  const next: ReleaseHoldPersonRecord = { v: RELEASE_HOLD_PERSON_VERSION, pr: held.pr, act: 'lift', head: held.head, at, by: ports.who };
  const wrote = await ports.store.write(next);
  if (!wrote.ok) return no('unaskable', 'the person hold file could not be written. The hold stays.');
  return { ok: true, act: 'lift', pr: held.pr, head: held.head, at };
};
