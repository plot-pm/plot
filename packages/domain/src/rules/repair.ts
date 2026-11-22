import type { Containment, FirstParentCommit } from '../ports/refs.js';
import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { CandidateCommit, RepairRecord } from '../entities/repair-record.js';
import { type CandidateRuns, defaultBranchRed } from './default-branch.js';

/**
 * The episode's candidates: the first-parent commits of `lastGreenSha..firstRedSha`.
 *
 * PURE. A `forward` merge carries the excluded side's content and no commit of
 * the range's own, so it is not a candidate: reverting it would remove content
 * the episode's window never introduced.
 *
 * @param commits - the range's first-parent commits, as {@link Refs.firstParentCommits} reads them.
 * @returns the `{sha, subject}` of each non-forward commit, in the order given.
 */
export const candidatesFromCommits = (commits: readonly FirstParentCommit[]): CandidateCommit[] =>
  commits.filter((commit) => !commit.forward).map(({ sha, subject }) => ({ sha, subject }));

/**
 * One candidate commit, with the readings the picker needs about it.
 *
 * Supplied as a value — never fetched here.
 */
export interface RedMainCandidate extends CandidateCommit {
  /** Whether the host reads this candidate's own PR, if any, as `MERGED`. */
  prMerged: boolean;
  /**
   * The host's `Host.prMergeCommit` answer for the PR this candidate's subject
   * names, or `''` where the subject names none or the host answered none.
   */
  hostMergeCommit: string;
  /**
   * This candidate's own runs, from `candidateRunsOf`: `green`, `red`,
   * `pending`, `unknown`, or `cancelled` where its CI run was cancelled.
   */
  runs: CandidateRuns;
  /** Whether this commit changes, adds or removes a `State:` line. */
  touchesState: boolean;
  /**
   * Whether this commit changes at least one file and every file it changes
   * lies in `syncPathSet`: plan, index, sprint, release and brief files.
   */
  plotDataOnly: boolean;
}

/**
 * What the picker answers: a PR number, `hold` where the first non-green
 * candidate has not settled, `cancelled` with the sha of a code commit whose
 * CI run was cancelled, or `unknown` where no PR can be named.
 */
export type RedMainPickerAnswer = { pr: number } | { cancelled: string } | 'hold' | 'unknown';

/** The squash-merge shape GitHub and Bitbucket both write: `Title (#N)`. */
const SQUASH = /\(#(\d+)\)$/;

/**
 * GitHub's merge-commit subject, `<number>` captured.
 *
 * Mirrors `MERGE_SUBJECT_FORMS.github` in
 * `packages/domain/src/adapters/host/merge-subjects.ts` — that file matches a
 * KNOWN branch name the picker does not have, so this reads the same shape
 * for its `<number>` alone rather than reusing the host adapter's own matcher.
 */
const GITHUB_MERGE = /^Merge pull request #(\d+) from \S+$/;

/**
 * Bitbucket Cloud's merge-commit subject, `<number>` captured.
 *
 * Mirrors `MERGE_SUBJECT_FORMS.bitbucket` in the same adapter file, for the
 * same reason {@link GITHUB_MERGE} does.
 */
const BITBUCKET_MERGE = /^Merged in \S+ \(pull request #(\d+)\)$/;

/**
 * Reads the PR number a commit's subject names.
 *
 * Tries the squash shape first (`Title (#N)`), since a merge-commit subject
 * never ends that way; falls back to GitHub's and Bitbucket's merge-commit
 * forms.
 *
 * @param subject - the commit's subject line.
 * @returns the PR number, or null where the subject names none.
 */
export const prNumberOf = (subject: string): number | null => {
  const squash = SQUASH.exec(subject);
  if (squash) return Number(squash[1]);
  const firstForm = GITHUB_MERGE.exec(subject);
  if (firstForm) return Number(firstForm[1]);
  const secondForm = BITBUCKET_MERGE.exec(subject);
  if (secondForm) return Number(secondForm[1]);
  return null;
};

/**
 * The breaking-commit picker: which PR merge, if any, turned main red.
 *
 * PURE, over the candidates a caller already fixed at the episode's two
 * recorded SHAs — this never reads the moving settled SHA, so the fix PR's own
 * merge and a bundle bot's push can never enter the window.
 *
 * Walks the candidates oldest first, in merge order, and skips each whose runs
 * read `green`, and each whose runs read `cancelled` and that is
 * `plotDataOnly`. The first other candidate decides:
 * - `pending` or `unknown` runs answer `hold`; a later red candidate contains
 *   the earlier one's change, so it is never named in its place;
 * - `cancelled` runs answer `{ cancelled: sha }`, for the same reason: no
 *   later PR is named in its place;
 * - `red` runs answer that candidate's PR number when its subject names a PR,
 *   the host reads that PR `MERGED`, the host's `mergeCommit` equals the
 *   candidate's sha, and the candidate changes no `State:` line.
 *
 * Every other shape — no candidates, every candidate green, a first red
 * candidate that is a direct push, a Plot-path commit, a `State:` commit or a
 * PR whose merge commit points elsewhere — answers `unknown`. `unknown` never
 * reverts.
 *
 * @param candidates - the episode's candidates NEWEST first, the order the
 *   repair record stores them; the picker reads them from the end.
 * @returns the PR number of the breaking merge, `hold`, or `unknown`.
 */
export const redMainPicker = (candidates: readonly RedMainCandidate[]): RedMainPickerAnswer => {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.runs === 'green') continue;
    if (candidate.runs === 'cancelled') {
      if (candidate.plotDataOnly) continue;
      return { cancelled: candidate.sha };
    }
    if (candidate.runs !== 'red') return 'hold';
    const number = prNumberOf(candidate.subject);
    if (number === null) return 'unknown';
    if (!candidate.prMerged) return 'unknown';
    if (candidate.hostMergeCommit !== candidate.sha) return 'unknown';
    if (candidate.touchesState) return 'unknown';
    return { pr: number };
  }
  return 'unknown';
};

/** What `redMainStep` answers. */
export type RedMainStepAnswer =
  | 'none'
  | 'hold'
  | 'await-rerun'
  | 'start-repair'
  | 'await-repair'
  | 'revert'
  | 'close-prs'
  | 'exhausted';

/** What `redMainStep` reads, besides the default-branch reading and the record. */
export interface RedMainStepInput {
  /** Epoch ms. */
  now: number;
  /** The `Checks wait` bound, in milliseconds. */
  checksWaitMs: number;
  /** The `Main repair bound`, in milliseconds. */
  mainRepairBoundMs: number;
  /**
   * Whether the reading's settled commit descends from the record's first red
   * SHA — a first-parent ancestry answer, supplied as a value.
   *
   * `redMainStep` reads readings, never ports: this is what lets a moved red
   * SHA within the same episode still answer `revert` or `await-repair`
   * instead of being read as a new, unrelated red.
   */
  descendsFromRecordedRed: Containment;
  /** The breaking-commit picker's answer for this episode, where the record holds candidates. */
  pickerAnswer: RedMainPickerAnswer;
  /** Whether the re-run this episode asked for has settled, where `record.rerun === 'asked'`. */
  rerunSettled: 'pending' | 'green' | 'red' | 'none';
  /** Whether a repair PR is open and still in review, where `record.state === 'repairing'`. */
  repairInFlight: boolean;
  /** Whether the record's last-green re-run (before a revert) settled, and how. */
  lastGreenRerunSettled: 'pending' | 'green' | 'red' | 'none';
}

/**
 * An episode is open while no green has settled since the record was written
 * and the settled SHA descends from the record's red SHA.
 *
 * @param reading - the default-branch reading.
 * @param record - the repair record.
 * @param descendsFromRecordedRed - a first-parent ancestry answer for the
 *   settled SHA against the record's `firstRedSha`, supplied by the caller.
 * @returns true while the episode this record opened is still open.
 */
export const episodeOpen = (
  reading: DefaultBranchReading | null,
  record: RepairRecord,
  descendsFromRecordedRed: Containment,
): boolean => {
  if (reading?.settled === undefined) return false;
  if (reading.settled.state === 'green') return false;
  if (reading.settled.sha === record.firstRedSha) return true;
  return descendsFromRecordedRed === 'yes';
};

/**
 * The domain rule a red default branch is repaired through.
 *
 * SPAWNS NOTHING AND AWAITS NOTHING. Every input is a reading a caller already
 * took; this answers which step comes next and the caller performs it.
 *
 * The rule pins the EPISODE, not one SHA: {@link episodeOpen} holds while no
 * green has settled since the record opened and the settled commit descends
 * from the record's first red SHA. A moved red SHA within that episode still
 * answers `revert` or `await-repair`; only a settled green closes it.
 *
 * - No record, reading not red: `none`. No record, red reading: `hold` — the
 *   refresh writes the record on its own next pass; this rule writes none.
 * - A terminal record (`done` or `exhausted`): `none`.
 * - The episode has closed (a green settled since, or the settled commit no
 *   longer descends from the record's red): `close-prs`.
 * - The reading is too old for {@link defaultBranchRed}: `hold`. This gates
 *   every later answer, `revert` included: a stale reading never reverts.
 * - `idle` or `rerun`: reads {@link RedMainStepInput.rerunSettled} for the
 *   first red SHA's re-run — `'none'`/`'pending'` holds `await-rerun`; `'red'`
 *   moves to `start-repair`. `'green'` never closes the episode: a settled green
 *   closed it above, so the settled reading is red here. A settled commit
 *   after the first red SHA answers `start-repair` (a flake on the first red
 *   SHA does not clear a later red); the first red SHA itself answers
 *   `await-rerun`, because two readings of one commit disagree for one beat
 *   and neither starts an agent nor closes the episode.
 * - `repairing`: `await-repair` while the attempt is in flight and the bound
 *   has not passed; `start-repair` if no attempt is recorded yet.
 * - `reverting`: `exhausted` once a revert PR is already recorded (one
 *   episode reverts once) or the pre-revert re-run of the last green SHA read
 *   red (a red re-run there points outside the repository); `await-repair`
 *   while that re-run is still pending or unasked.
 * - Once the bound passes (`now - redSince >= mainRepairBoundMs`) with the
 *   episode still open: `revert` requires the head to equal the settled
 *   commit (no newer head pending); the picker answering `unknown` or
 *   `{ cancelled }` answers `exhausted` instead; a pending head holds at `hold`.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @param record - the repair record, or null where none exists.
 * @param input - the clock, the bounds, and the readings this rule cannot take itself.
 * @returns the next step.
 */
export const redMainStep = (
  reading: DefaultBranchReading | null,
  record: RepairRecord | null,
  input: RedMainStepInput,
): RedMainStepAnswer => {
  if (record === null) {
    return defaultBranchRed(reading, input.now, input.checksWaitMs) ? 'hold' : 'none';
  }

  if (record.state === 'done' || record.state === 'exhausted') return 'none';

  if (!episodeOpen(reading, record, input.descendsFromRecordedRed)) return 'close-prs';

  if (!defaultBranchRed(reading, input.now, input.checksWaitMs) || reading === null || reading.settled === undefined) {
    return 'hold';
  }

  if (record.state === 'idle' || record.state === 'rerun') {
    if (input.rerunSettled === 'green') {
      return reading.settled.sha === record.firstRedSha ? 'await-rerun' : 'start-repair';
    }
    if (input.rerunSettled === 'red') return 'start-repair';
    return 'await-rerun';
  }

  const boundReached = input.now - Date.parse(record.redSince) >= input.mainRepairBoundMs;

  if (record.state === 'repairing') {
    if (!boundReached) return input.repairInFlight ? 'await-repair' : 'start-repair';
  } else {
    if (record.revertPr !== undefined) return 'exhausted';
    if (input.lastGreenRerunSettled === 'red') return 'exhausted';
    if (!boundReached || input.lastGreenRerunSettled !== 'green') return 'await-repair';
  }

  if (reading.headSha !== reading.settled.sha) return 'hold';

  if (input.pickerAnswer === 'hold') return 'hold';

  if (input.pickerAnswer === 'unknown' || 'cancelled' in input.pickerAnswer) return 'exhausted';

  return 'revert';
};

/** What a merged revert PR means while the episode still reads red. */
export type MergedRevertAnswer = 'exhausted' | 'await-revert' | 'hold';

/**
 * Whether a merged revert PR ends the episode at `exhausted`.
 *
 * SPAWNS NOTHING AND AWAITS NOTHING. The caller supplies the ancestry answer.
 *
 * After the revert merges, the settled reading names an older red commit until
 * the revert's merge commit settles. Only a settled commit that contains the
 * merge commit shows the revert did not turn the default branch green.
 *
 * - The settled SHA equals the merge commit, or contains it: `exhausted`.
 * - The settled commit does not contain the merge commit: `await-revert`.
 * - No settled commit, no merge commit from the host, or an ancestry answer
 *   of `unknown`: `hold`.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @param mergeCommit - the revert PR's merge commit SHA; `''` where the host did not say.
 * @param settledContainsMerge - an ancestry answer for the merge commit
 *   against the settled SHA, supplied by the caller.
 * @returns the next step for the merged revert.
 */
export const mergedRevertStep = (
  reading: DefaultBranchReading | null,
  mergeCommit: string,
  settledContainsMerge: Containment,
): MergedRevertAnswer => {
  if (reading?.settled === undefined || mergeCommit === '') return 'hold';
  if (reading.settled.sha === mergeCommit || settledContainsMerge === 'yes') return 'exhausted';
  if (settledContainsMerge === 'no') return 'await-revert';
  return 'hold';
};
