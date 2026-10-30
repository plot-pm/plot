import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { Pr } from '../entities/pr.js';
import { encodeRepairRecord, type RepairRecord } from '../entities/repair-record.js';
import type { DefaultBranchStore } from '../ports/default-branch.js';
import type { Host } from '../ports/host.js';
import type { Refs } from '../ports/refs.js';
import type { RepairRecordStore } from '../ports/repair-record.js';
import { EPISODE_LINE_DEPTH, mainRepairBranchOf, repairEpisode, type EpisodeReading } from '../rules/repair-pr.js';
import type { Caller } from './decision.js';

/** Why recording a repair PR refused. Each ends the action: the record is unchanged. */
export type NameRepairPrRefusal =
  | 'unattended'
  | 'unaskable'
  | 'no-open-episode'
  | 'no-last-green'
  | 'pr-not-open'
  | 'repair-branch-mismatch'
  | 'repair-pr-already-named'
  | 'record-moved';

/** What recording a repair PR reads. */
export interface NameRepairPrReadings {
  /** Who is asking; an unattended caller is refused before anything else is read. */
  readonly caller: Caller;
  /** The repair record; null where none exists, `unaskable` where the read failed. */
  readonly record: RepairRecord | null | 'unaskable';
  /** The record's episode, from `repairEpisode`; `closed` where there is no record or no red reading. */
  readonly episode: EpisodeReading;
  /** The PR as the host answers now; null where the host holds none, `unaskable` where it did not answer. */
  readonly pr: Pr | null | 'unaskable';
}

/** What recording a repair PR answers. */
export type NameRepairPrOutcome =
  | { readonly outcome: 'decided'; readonly record: RepairRecord; readonly branch: string }
  | { readonly outcome: 'refused'; readonly reason: NameRepairPrRefusal; readonly detail: string };

/** The refused half of {@link NameRepairPrOutcome}. */
type NameRepairPrRefused = Extract<NameRepairPrOutcome, { outcome: 'refused' }>;

const no = (reason: NameRepairPrRefusal, detail: string): NameRepairPrOutcome => ({ outcome: 'refused', reason, detail });

/**
 * Decides whether a person may record a PR as the repair PR of the open episode.
 *
 * Refuses, in this order: `unattended` for an unattended caller; `unaskable`
 * where the record read failed; `no-open-episode` where no record exists or
 * its episode is closed; `unaskable` where the episode could not be read;
 * `no-last-green` where the record has no last green SHA, so the episode has
 * no repair branch; `unaskable` where the host did not answer for the PR;
 * `pr-not-open` for an unknown, merged or closed PR; `repair-branch-mismatch`
 * where the PR's head is not `bug/main-repair-<12 hex of lastGreenSha>`; and
 * `repair-pr-already-named` where the record already names another repair PR.
 *
 * @param readings - the caller, the record, its episode and the host's PR answer.
 * @param pr - the PR number to record.
 * @returns the record with `repairPr` set, and the repair branch; or the first refusal.
 */
export const nameRepairPr = (readings: NameRepairPrReadings, pr: number): NameRepairPrOutcome => {
  if (readings.caller === 'unattended') {
    return no('unattended', `an unattended caller does not record a repair PR. A person names PR #${pr} as the repair of a red default branch.`);
  }
  const { record } = readings;
  if (record === 'unaskable') return no('unaskable', 'the repair record could not be read. A failed read is not an absent record; nothing was written.');
  if (record === null || readings.episode === 'closed') {
    return no('no-open-episode', record === null ? 'no repair record exists, so no red episode is open to repair.' : `the repair record's episode (first red ${record.firstRedSha.slice(0, 12)}, state '${record.state}') is not open on the settled red commit.`);
  }
  if (readings.episode === 'unaskable') {
    return no('unaskable', `the first-parent line of ${record.branch} could not be read, so the episode cannot be checked. Nothing was written.`);
  }
  const branch = mainRepairBranchOf(record.lastGreenSha);
  if (branch === null) {
    return no('no-last-green', 'the repair record has no last green SHA, so the episode has no repair branch to admit. Nothing was written.');
  }
  const found = readings.pr;
  if (found === 'unaskable') return no('unaskable', `the host did not answer for PR #${pr}. Nothing was written.`);
  if (found === null || found.state !== 'OPEN') {
    return no('pr-not-open', `PR #${pr} is ${found === null ? 'unknown to the host' : found.state}. Only an open PR is recorded as the repair.`);
  }
  if (found.head !== branch) {
    return no('repair-branch-mismatch', `PR #${pr} comes from '${found.head}', but the repair PR of this episode must come from ${branch}. Open the fix on that branch, then record it.`);
  }
  if (record.repairPr !== undefined && record.repairPr !== pr) {
    return no('repair-pr-already-named', `the repair record already names PR #${record.repairPr} as this episode's repair PR. One repair attempt runs per episode; nothing was written.`);
  }
  return { outcome: 'decided', record: { ...record, repairPr: pr }, branch };
};

/** The ports recording a repair PR needs. */
export interface NameRepairPrPorts {
  readonly host: Pick<Host, 'prState'>;
  readonly refs: Pick<Refs, 'firstParentLine'>;
  readonly defaultBranch: DefaultBranchStore;
  readonly repair: RepairRecordStore;
  /** Who is asking; an unattended caller is refused before any read. */
  readonly caller: Caller;
}

/** What `plot-ask.mjs repair-pr` prints, as one JSON line. */
export type NameRepairPrResult =
  | { named: true; pr: number; branch: string }
  | { named: false; reason: NameRepairPrRefusal; detail: string };

/** Reads the episode of a record against the default-branch reading. */
const episodeOf = async (
  ports: NameRepairPrPorts,
  record: RepairRecord,
  reading: DefaultBranchReading | null,
): Promise<EpisodeReading> => {
  const settled = reading?.settled;
  if (reading === null || settled === undefined || settled.state !== 'red') return 'closed';
  const line = await ports.refs.firstParentLine(settled.sha, EPISODE_LINE_DEPTH);
  return repairEpisode(record, reading.branch, settled, line.ok ? line.value : 'unaskable');
};

/**
 * Records a PR as the repair PR of the open red episode, or refuses.
 *
 * Reads the record, the default-branch reading and the host's PR answer, and
 * asks {@link nameRepairPr}. Immediately before the write it reads the record
 * again and refuses `record-moved` where the record changed since the first
 * read, so a record fleetd replaced in between is not overwritten. A failed
 * default-branch read, re-read or write refuses as `unaskable`.
 *
 * @param ports - the host, refs, the default-branch store, the record store and the caller.
 * @param pr - the PR number to record.
 * @returns the recorded PR and its branch, or the refusal naming its reason.
 */
export const nameRepairPrAt = async (ports: NameRepairPrPorts, pr: number): Promise<NameRepairPrResult> => {
  const refused = (out: { reason: NameRepairPrRefusal; detail: string }): NameRepairPrResult => ({ named: false, reason: out.reason, detail: out.detail });
  if (ports.caller === 'unattended') {
    // nameRepairPr refuses an unattended caller before it looks at any other reading.
    return refused(nameRepairPr({ caller: 'unattended', record: null, episode: 'closed', pr: null }, pr) as NameRepairPrRefused);
  }
  const read = await ports.repair.read();
  const record = read.ok ? read.value : 'unaskable';
  let episode: EpisodeReading = 'closed';
  if (record !== 'unaskable' && record !== null) {
    const reading = await ports.defaultBranch.read();
    if (!reading.ok) return refused({ reason: 'unaskable', detail: 'the default-branch reading could not be read. Nothing was written.' });
    episode = await episodeOf(ports, record, reading.value);
  }
  const lookup = await ports.host.prState(pr);
  const out = nameRepairPr({ caller: ports.caller, record, episode, pr: lookup.ok ? lookup.value : 'unaskable' }, pr);
  if (out.outcome === 'refused') return refused(out);
  const again = await ports.repair.read();
  if (!again.ok) return refused({ reason: 'unaskable', detail: 'the repair record could not be read again before the write. Nothing was written.' });
  if (again.value === null || encodeRepairRecord(again.value) !== encodeRepairRecord(record as RepairRecord)) {
    return refused({ reason: 'record-moved', detail: 'the repair record changed after it was read. Nothing was written; run the command again.' });
  }
  const written = await ports.repair.write(out.record);
  if (!written.ok) return refused({ reason: 'unaskable', detail: 'the repair record could not be written. The record is unchanged.' });
  return { named: true, pr, branch: out.branch };
};
