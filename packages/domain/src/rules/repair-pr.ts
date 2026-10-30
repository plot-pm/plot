import type { RunsState, SettledReading } from '../entities/default-branch.js';
import type { RepairRecord } from '../entities/repair-record.js';

/** How many hex characters of the last green SHA the main-repair branch name carries. */
export const REPAIR_BRANCH_SHA_LENGTH = 12;

/**
 * How many first-parent commits of the settled SHA the episode check reads.
 *
 * A red default branch takes no merge except the repair PR, so the settled SHA
 * sits a few bundle commits past the first red SHA. A first red SHA deeper
 * than this reads as a closed episode, which refuses.
 */
export const EPISODE_LINE_DEPTH = 200;

/** The revert branch: `bug/revert-<pr>`, where `<pr>` is the reverted PR's number. */
const REVERT_BRANCH = /^bug\/revert-[1-9][0-9]*$/;

/**
 * The one branch a fix PR for this episode may come from.
 *
 * @param lastGreenSha - the record's last green SHA, absent where the episode opened with none.
 * @returns `bug/main-repair-<first 12 hex of lastGreenSha>`, or null where there is no last green SHA.
 */
export const mainRepairBranchOf = (lastGreenSha: string | undefined): string | null =>
  lastGreenSha === undefined || lastGreenSha === ''
    ? null
    : `bug/main-repair-${lastGreenSha.slice(0, REPAIR_BRANCH_SHA_LENGTH)}`;

/**
 * Whether a branch name has the revert branch's shape, `bug/revert-<pr>`.
 *
 * The record holds no number for the reverted PR, so this checks the shape and
 * not the number.
 *
 * @param branch - the PR's head branch.
 * @returns true for `bug/revert-` followed by a PR number.
 */
export const isRevertBranch = (branch: string): boolean => REVERT_BRANCH.test(branch);

/** Which of the record's two PR fields names a PR. */
export type RepairRole = 'repair' | 'revert';

/**
 * Which field of the record names a PR.
 *
 * @param record - the repair record.
 * @param pr - the PR number.
 * @returns `repair` where `repairPr` names it, `revert` where `revertPr` names it, null otherwise.
 */
export const repairRoleOf = (record: RepairRecord, pr: number): RepairRole | null => {
  if (record.repairPr === pr) return 'repair';
  if (record.revertPr === pr) return 'revert';
  return null;
};

/**
 * Whether a PR's head branch is the one its role in the record allows.
 *
 * @param record - the repair record.
 * @param role - the field of the record that names the PR.
 * @param head - the PR's head branch.
 * @returns true for a fix PR from {@link mainRepairBranchOf} the record's last
 *   green SHA, or a revert PR from `bug/revert-<pr>`.
 */
export const repairBranchMatches = (record: RepairRecord, role: RepairRole, head: string): boolean => {
  if (role === 'revert') return isRevertBranch(head);
  const expected = mainRepairBranchOf(record.lastGreenSha);
  return expected !== null && head === expected;
};

/** Whether the record's episode is still open, or why that could not be read. */
export type EpisodeReading = 'open' | 'closed' | 'unaskable';

/**
 * Reads whether a repair record's episode is still open.
 *
 * Open means all of: the record's state is not `done` or `exhausted`, the
 * default-branch reading names the record's branch, its settled commit is
 * `red`, and the settled commit's first-parent line holds the record's
 * `firstRedSha`. The line is evidence handed to this rule; the rule decides.
 *
 * @param record - the repair record.
 * @param branch - the default branch the reading names.
 * @param settled - the reading's settled commit, absent where none settled.
 * @param line - the settled commit's first-parent line, newest first, or
 *   `unaskable` where git could not walk it.
 * @returns `open`, `closed`, or `unaskable` where only the line could decide and it failed.
 */
export const repairEpisode = (
  record: RepairRecord,
  branch: string,
  settled: SettledReading | undefined,
  line: readonly string[] | 'unaskable',
): EpisodeReading => {
  if (record.state === 'done' || record.state === 'exhausted') return 'closed';
  if (record.branch !== branch || settled === undefined || settled.state !== 'red') return 'closed';
  if (line === 'unaskable') return 'unaskable';
  return line.includes(record.firstRedSha) ? 'open' : 'closed';
};

/** Why the repair exception refused a PR the record names. */
export type RepairMergeRefusal = 'repair-episode-closed' | 'repair-branch-mismatch' | 'repair-red-unconfirmed' | 'unaskable';

/** What the repair exception reads, beyond the PR and the default-branch reading. */
export interface RepairMergeReading {
  /** The repair record; null where none exists, `unaskable` where the read failed. */
  readonly record: RepairRecord | null | 'unaskable';
  /** The record's episode, from {@link repairEpisode}. */
  readonly episode: EpisodeReading;
  /** The settled red commit's runs, asked again for this merge and folded; `unaskable` where the ask failed. */
  readonly redRuns: RunsState | 'unaskable';
}

/**
 * Whether the repair record names a PR for the fleet to act on, outside the sprint scope.
 *
 * True where all hold: the record was read, its episode reads `open`,
 * `repairPr` or `revertPr` names the PR, and the PR's head branch matches
 * that role ({@link repairBranchMatches}). The re-asked runs are not read
 * here: the merge arm's {@link repairMergeVerdict} decides on them.
 *
 * @param reading - the record, the episode and the re-asked runs.
 * @param pr - the PR's number and head branch.
 * @returns true for the one PR an open episode names.
 */
export const repairNamesPr = (
  reading: RepairMergeReading,
  pr: { readonly number: number; readonly head: string },
): boolean => {
  const { record } = reading;
  if (record === null || record === 'unaskable' || reading.episode !== 'open') return false;
  const role = repairRoleOf(record, pr.number);
  return role !== null && repairBranchMatches(record, role, pr.head);
};

/** What the repair exception answers for one PR on a red default branch. */
export type RepairMergeVerdict =
  | { readonly verdict: 'not-named'; readonly why: string }
  | { readonly verdict: 'admitted'; readonly role: RepairRole }
  | { readonly verdict: 'refused'; readonly reason: RepairMergeRefusal; readonly detail: string };

/**
 * Decides whether a red default branch admits one PR as its repair.
 *
 * `not-named` where no record exists, the record could not be read, or neither
 * `repairPr` nor `revertPr` names the PR: the caller refuses it as
 * `default-branch-red`. For a named PR, in this order:
 * `repair-episode-closed` where {@link repairEpisode} reads `closed`;
 * `repair-branch-mismatch` where a fix PR's head is not
 * {@link mainRepairBranchOf} the record's last green SHA, or a revert PR's head
 * is not `bug/revert-<pr>`; `repair-red-unconfirmed` where the settled commit's
 * runs, asked again, no longer read `red`. A failed episode walk or a failed
 * re-ask refuses as `unaskable`.
 *
 * @param reading - the record, the episode and the re-asked runs.
 * @param pr - the PR's number and head branch.
 * @returns the verdict.
 */
export const repairMergeVerdict = (
  reading: RepairMergeReading,
  pr: { readonly number: number; readonly head: string },
): RepairMergeVerdict => {
  const { record } = reading;
  if (record === 'unaskable') return { verdict: 'not-named', why: 'the repair record could not be read' };
  if (record === null) return { verdict: 'not-named', why: 'no repair record exists' };
  const role = repairRoleOf(record, pr.number);
  if (role === null) return { verdict: 'not-named', why: `the repair record does not name PR #${pr.number}` };
  if (reading.episode === 'unaskable') {
    return { verdict: 'refused', reason: 'unaskable', detail: `the first-parent line of ${record.branch} could not be read, so the episode of the repair record cannot be checked. Nothing was merged.` };
  }
  if (reading.episode === 'closed') {
    return { verdict: 'refused', reason: 'repair-episode-closed', detail: `the repair record's episode (first red ${record.firstRedSha.slice(0, 12)}, state '${record.state}') is not open on the settled red commit. A closed episode admits no PR.` };
  }
  if (!repairBranchMatches(record, role, pr.head)) {
    const expected = mainRepairBranchOf(record.lastGreenSha);
    const wanted = role === 'repair' ? (expected ?? 'no branch: the record has no last green SHA') : 'bug/revert-<pr>';
    return { verdict: 'refused', reason: 'repair-branch-mismatch', detail: `PR #${pr.number} comes from '${pr.head}', but the ${role} PR of this episode must come from ${wanted}. Nothing was merged.` };
  }
  if (reading.redRuns === 'unaskable') {
    return { verdict: 'refused', reason: 'unaskable', detail: `the runs of the red commit could not be asked again before the merge of PR #${pr.number}. Nothing was merged.` };
  }
  if (reading.redRuns !== 'red') {
    return { verdict: 'refused', reason: 'repair-red-unconfirmed', detail: `the runs of the red commit now read '${reading.redRuns}'. The repair exception holds only while they read 'red'; nothing was merged.` };
  }
  return { verdict: 'admitted', role };
};

/**
 * Whether fleetd keeps the record on disk instead of opening a new one.
 *
 * fleetd opens a record at the change from green to red. A record that names
 * the same branch and the same first red SHA, and is not `done` or
 * `exhausted`, is that episode's record already; replacing it would drop the
 * `repairPr` a person recorded on it.
 *
 * @param existing - the record on disk, or null where none exists.
 * @param branch - the default branch of the new episode.
 * @param firstRedSha - the first red SHA of the new episode.
 * @returns true where the existing record is kept.
 */
export const keepsRepairRecord = (existing: RepairRecord | null, branch: string, firstRedSha: string): boolean =>
  existing !== null &&
  existing.branch === branch &&
  existing.firstRedSha === firstRedSha &&
  existing.state !== 'done' &&
  existing.state !== 'exhausted';
