import type { Containment } from '../ports/refs.js';
import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { CandidateCommit, RepairRecord } from '../entities/repair-record.js';
import { defaultBranchAgeMs, defaultBranchRed } from './default-branch.js';

/**
 * The episode's candidates: the first-parent SHAs strictly between the last
 * green and the first red commit, with each one's subject.
 *
 * PURE — a caller supplies the first-parent line (newest first, the first red
 * SHA first) and the subjects of a wider range; this intersects them rather
 * than reading git itself, so it adds no port operation of its own. A SHA on
 * the first-parent line with no matching subject is dropped: {@link Refs.commitSubjects}
 * failing to cover the whole line means the subject is unknown, not that the
 * commit does not exist.
 *
 * @param firstParentLine - the first red SHA and its first-parent ancestors,
 *   newest first, as {@link Refs.firstParentLine} reads them.
 * @param subjects - `{sha, subject}` pairs covering at least the line, in any order.
 * @param lastGreenSha - the boundary the window stops at, exclusive.
 * @returns the candidates, newest first, excluding `lastGreenSha` itself.
 */
export const candidatesFromLine = (
  firstParentLine: readonly string[],
  subjects: readonly CandidateCommit[],
  lastGreenSha: string,
): CandidateCommit[] => {
  const bySha = new Map(subjects.map((entry) => [entry.sha, entry.subject]));
  const boundary = firstParentLine.indexOf(lastGreenSha);
  const window = firstParentLine.slice(0, boundary === -1 ? undefined : boundary);
  const result: CandidateCommit[] = [];
  for (const sha of window) {
    const subject = bySha.get(sha);
    if (subject !== undefined) result.push({ sha, subject });
  }
  return result;
};

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
  /** Whether this candidate is settled red on its own runs. */
  settledRed: boolean;
  /** Whether this commit changes, adds or removes a `State:` line. */
  touchesState: boolean;
}

/** What the picker answers: a PR number, or `unknown` where no single candidate qualifies. */
export type RedMainPickerAnswer = { pr: number } | 'unknown';

/** The squash-merge shape GitHub and Bitbucket both write: `Title (#N)`. */
const SQUASH = /\(#(\d+)\)$/;

/**
 * GitHub's merge-commit subject, `<number>` captured.
 *
 * Mirrors `MERGE_SUBJECT_FORMS.github` in
 * `packages/domain/src/adapters/host/merge-subjects.ts` — that file matches a
 * KNOWN branch name the picker does not have, so this reads the same shape
 * for its `<number>` alone rather than reusing `mergedBySubject`.
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
const prNumberOf = (subject: string): number | null => {
  const squash = SQUASH.exec(subject);
  if (squash) return Number(squash[1]);
  const github = GITHUB_MERGE.exec(subject);
  if (github) return Number(github[1]);
  const bitbucket = BITBUCKET_MERGE.exec(subject);
  if (bitbucket) return Number(bitbucket[1]);
  return null;
};

/**
 * The breaking-commit picker: which PR merge, if any, turned main red.
 *
 * PURE, over the candidates a caller already fixed at the episode's two
 * recorded SHAs — this never reads the moving settled SHA, so the fix PR's own
 * merge and a bundle bot's push can never enter the window.
 *
 * Answers a PR number only when EXACTLY ONE candidate qualifies, meeting every
 * one of:
 * - its subject names a PR number (squash `Title (#N)`, or GitHub's or
 *   Bitbucket's merge-commit form);
 * - the host reads that PR `MERGED`;
 * - the host's `mergeCommit` for that PR equals the candidate's own sha;
 * - the candidate is itself settled red on its own runs;
 * - the candidate changes, adds or removes no `State:` line.
 *
 * Every other shape — no candidate qualifying, more than one qualifying, a
 * direct push with no PR number, a PR number whose `mergeCommit` points
 * elsewhere, a candidate that touches a `State:` line — answers `unknown`.
 * `unknown` never reverts.
 *
 * @param candidates - the episode's candidates, in any order.
 * @returns the PR number of the one breaking commit, or `unknown`.
 */
export const redMainPicker = (candidates: readonly RedMainCandidate[]): RedMainPickerAnswer => {
  const qualifying = candidates.filter((candidate) => {
    const number = prNumberOf(candidate.subject);
    if (number === null) return false;
    if (!candidate.prMerged) return false;
    if (candidate.hostMergeCommit !== candidate.sha) return false;
    if (!candidate.settledRed) return false;
    if (candidate.touchesState) return false;
    return true;
  });
  if (qualifying.length !== 1) return 'unknown';
  const number = prNumberOf(qualifying[0]!.subject);
  return number === null ? 'unknown' : { pr: number };
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
 *   `hold`, `await-rerun` and `start-repair` alike — only `revert` uses the
 *   stricter {@link defaultBranchAgeMs}.
 * - `idle` or `rerun`: reads {@link RedMainStepInput.rerunSettled} for the
 *   first red SHA's re-run — `'none'`/`'pending'` holds `await-rerun`;
 *   `'green'` answers `close-prs` (the episode ends with no agent); `'red'`
 *   moves to `start-repair`.
 * - `repairing`: `await-repair` while the attempt is in flight and the bound
 *   has not passed; `start-repair` if no attempt is recorded yet.
 * - `reverting`: `exhausted` once a revert PR is already recorded (one
 *   episode reverts once) or the pre-revert re-run of the last green SHA read
 *   red (a red re-run there points outside the repository); `await-repair`
 *   while that re-run is still pending or unasked.
 * - Once the bound passes (`now - redSince >= mainRepairBoundMs`) with the
 *   episode still open: `revert` requires the reading to be fresh by
 *   {@link defaultBranchAgeMs} and the head to equal the settled commit (no
 *   newer head pending); the picker answering `unknown` answers `exhausted`
 *   instead; a stale reading or a pending head holds at `hold`.
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
    if (input.rerunSettled === 'green') return 'close-prs';
    if (input.rerunSettled === 'red') return 'start-repair';
    return 'await-rerun';
  }

  const boundReached = input.now - Date.parse(record.redSince) >= input.mainRepairBoundMs;

  if (record.state === 'repairing') {
    if (!boundReached) return input.repairInFlight ? 'await-repair' : 'start-repair';
  } else if (record.state === 'reverting') {
    if (record.revertPr !== undefined) return 'exhausted';
    if (input.lastGreenRerunSettled === 'red') return 'exhausted';
    if (!boundReached || input.lastGreenRerunSettled !== 'green') return 'await-repair';
  }

  if (!boundReached) return 'start-repair';

  const age = defaultBranchAgeMs(reading, input.now);
  if (age === null || age > input.checksWaitMs) return 'hold';
  if (reading.headSha !== reading.settled.sha) return 'hold';

  if (input.pickerAnswer === 'unknown') return 'exhausted';

  return 'revert';
};
