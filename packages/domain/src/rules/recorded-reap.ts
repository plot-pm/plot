import type { ReapRecordRow, ReapRecordSnapshot } from '../ports/reap-record.js';
import { reapProblems, type ReapProblem, type TreeReadings } from './reapable.js';

/** Why a whole record is refused before any row is checked. */
export type RecordRefusal = 'foreign-repo' | 'stale';

/**
 * Whether a record may be acted on at all, before any row is checked.
 *
 * Two whole-record gates, checked once rather than per row: a record written
 * for a different checkout (`repoIdentity` mismatch — a copied or shared
 * file), and a record old enough that `Checks wait` no longer vouches for it.
 * Neither is a per-row concern, so neither belongs in
 * {@link recordedBranchVerdict} or {@link recordedWorktreeVerdict}.
 *
 * @param snapshot - the record `--dry-run` wrote.
 * @param currentRepoIdentity - this run's own `git rev-parse --git-common-dir` realpath.
 * @param nowMs - the current time, in epoch milliseconds.
 * @param checksWaitMs - how long a record stays trustworthy, in milliseconds.
 * @returns the refusal, or `null` when the record may be read for rows.
 */
export const recordRefusal = (
  snapshot: ReapRecordSnapshot,
  currentRepoIdentity: string,
  nowMs: number,
  checksWaitMs: number,
): RecordRefusal | null => {
  if (snapshot.repoIdentity !== currentRepoIdentity) return 'foreign-repo';
  const at = Date.parse(snapshot.at);
  if (!Number.isFinite(at) || nowMs - at > checksWaitMs) return 'stale';
  return null;
};

/**
 * Why a recorded row no longer survives the intersection `--yes` runs against
 * it.
 *
 * `not-recorded` is the one reason with no row at all — a bare `--yes` with no
 * record, or a branch/worktree/claim a person removed from the record by hand
 * (the brief's "removing rows from the record narrows a run"). Every other
 * reason names a LIVE reading that changed since the dry run looked.
 */
export type RecordedRowRefusal =
  | 'not-recorded'
  | 'tip-changed'
  | 'now-checked-out'
  | 'default-branch'
  | 'pr-not-merged'
  | ReapProblem['refusal'];

/** One recorded row's fate: delete it, or keep it for a named reason. */
export interface RecordedRowVerdict {
  /** The row's identity — a branch name, or a worktree path. */
  identity: string;
  /** Whether the row survives the intersection. */
  act: boolean;
  /** Why it was kept, in order of urgency; empty when {@link act} is true. */
  refusals: readonly RecordedRowRefusal[];
}

/** What a fresh, narrow check reads about one recorded branch or claim row. */
export interface BranchRowCheck {
  /** The branch's current tip sha, read live. */
  tipSha: string;
  /** Whether any worktree holds the branch NOW, read live. */
  checkedOut: boolean;
  /** The repository's default branch. */
  defaultBranch: string;
}

/**
 * Whether a recorded branch or claim row still holds.
 *
 * Three live readings, each able to withdraw the record's permission on its
 * own: the branch moved since the dry run looked, something checked it out
 * since, or it turned out to BE the default branch (a record from before a
 * default-branch rename, say). None of the three is re-derived from the
 * record — each is read fresh, per the brief's settled decision that the
 * record is read by content and never trusted as a bare confirmation token.
 *
 * @param row - the recorded row, or `undefined` when nothing recorded this
 *   identity — the brief's "removing rows from the record narrows a run".
 * @param check - what a fresh, narrow re-check found.
 * @returns the verdict: act, or keep for the reasons found.
 */
export const recordedBranchVerdict = (
  row: ReapRecordRow | undefined,
  check: BranchRowCheck,
): RecordedRowVerdict => {
  if (row === undefined) {
    return { identity: '', act: false, refusals: ['not-recorded'] };
  }
  const refusals: RecordedRowRefusal[] = [];
  if (check.tipSha !== row.tipSha) refusals.push('tip-changed');
  if (check.checkedOut) refusals.push('now-checked-out');
  if (row.identity === check.defaultBranch) refusals.push('default-branch');
  return { identity: row.identity, act: refusals.length === 0, refusals };
};

/**
 * Whether a recorded worktree row still holds.
 *
 * TWO GATES, NEITHER WAIVED BY THE OTHER. The live gate is
 * {@link reapProblems} run again, unchanged — the same five refusals a bare
 * `--yes` always ran, because the record names no exemption from them. The
 * record's OWN limit is additional: a desk whose tip moved since the dry run
 * recorded it is not the desk the operator approved, even where the live gate
 * alone would allow it today.
 *
 * @param row - the recorded row, or `undefined` when nothing recorded this
 *   worktree's path.
 * @param live - a fresh reading of the worktree, taken now.
 * @returns the verdict: act, or keep for the reasons found — the record's own
 *   `tip-changed` first, then every live refusal in {@link reapProblems}'s
 *   own order.
 */
export const recordedWorktreeVerdict = (
  row: ReapRecordRow | undefined,
  live: TreeReadings & { tipSha: string },
): RecordedRowVerdict => {
  if (row === undefined) {
    return { identity: '', act: false, refusals: ['not-recorded'] };
  }
  const refusals: RecordedRowRefusal[] = [];
  if (live.tipSha !== row.tipSha) refusals.push('tip-changed');
  for (const problem of reapProblems(live)) refusals.push(problem.refusal);
  return { identity: row.identity, act: refusals.length === 0, refusals };
};

/**
 * Whether a row recorded as "PR merged" still reads that way.
 *
 * The brief's third kind of recheck: the dry run saw a host answer, and a
 * host answer can flip between runs — the exact divergence #2825 reports. So
 * the one reason this check exists is re-asking the SAME question the dry
 * run asked, never a different one: anything but a fresh `'merged'` keeps the
 * branch, including `'not-merged'` and a throttled or failed re-ask, because
 * silence from the host is never permission to delete.
 *
 * @param freshAnswer - the host's answer to `prMerged(branch)`, asked again
 *   now; `null` when the call failed or was throttled.
 * @returns true when the fresh answer still says merged.
 */
export const stillPrMerged = (freshAnswer: 'merged' | 'not-merged' | 'unknown' | null): boolean =>
  freshAnswer === 'merged';
