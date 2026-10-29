import type { PortResult } from '../port-result.js';

/** What kind of leftover one recorded row names. */
export type ReapRecordRowKind = 'worktree' | 'branch' | 'claim';

/** One worktree, branch, or claim a `--dry-run` decided to act on. */
export interface ReapRecordRow {
  /** Which kind of leftover this row is. */
  readonly kind: ReapRecordRowKind;
  /** The worktree path for a `worktree` row, the branch name otherwise. */
  readonly identity: string;
  /** The tip commit the row was decided against, read again before `--yes` acts. */
  readonly tipSha: string;
  /** Why the dry run decided to act on it, for the operator reading the record. */
  readonly reason: string;
}

/**
 * One `--dry-run`'s snapshot: what it decided, and the state it decided
 * against.
 *
 * Read again by content at `--yes` time, never trusted as a confirmation
 * token — see `ReapRecord`.
 */
export interface ReapRecordSnapshot {
  /** The realpath of `git rev-parse --git-common-dir`, so a record from another checkout is refused. */
  readonly repoIdentity: string;
  /** The default branch name the dry run resolved. */
  readonly defaultBranch: string;
  /** The `origin/<default>` SHA the dry run read, so a moved default branch is detectable. */
  readonly defaultBranchSha: string;
  /** When the dry run ran, ISO 8601 UTC. */
  readonly at: string;
  /** One row per worktree, branch, or claim the dry run decided to act on. */
  readonly rows: readonly ReapRecordRow[];
}

/**
 * Where `plot-reap --dry-run` writes what it decided, and `--yes` reads it
 * back.
 *
 * ONE SNAPSHOT, OVERWRITTEN EACH `--dry-run` — unlike {@link PinnedTips}'s
 * `reaped.tsv`, which appends a row per pin and is never replaced. A record
 * answers *what did the last dry run decide*, not *every dry run this
 * checkout ever ran*, so a new `--dry-run` replaces rather than adds to it.
 *
 * `--yes` reads this content and re-derives whether each row still holds —
 * see `rules/sweepable.ts`'s row-intersection rule — rather than treating the
 * record's mere existence as a confirmation to act on.
 */
export interface ReapRecord {
  /**
   * Replaces the record with a new snapshot.
   *
   * @param snapshot - what the dry run just decided.
   * @returns `answered(undefined)` on success, `failed()` on a write error.
   */
  write: (snapshot: ReapRecordSnapshot) => Promise<PortResult<undefined>>;

  /**
   * Reads the current snapshot.
   *
   * @returns `answered(snapshot)` when a record exists, `answered(null)` when
   *   none does — absence is a legitimate answer, not a failure — or
   *   `failed()` on a read error (a record exists but could not be parsed).
   */
  read: () => Promise<PortResult<ReapRecordSnapshot | null>>;
}
