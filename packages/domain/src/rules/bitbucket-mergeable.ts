import type { Mergeability } from '../entities/pr.js';

/** The `mergeable` word plus why, where the word is `unknown`. */
export interface MergeableReading {
  mergeable: Mergeability;
  /** Absent where `mergeable` is not `unknown`. */
  mergeableReason?: string;
}

const UNKNOWN = (reason: string): MergeableReading => ({ mergeable: 'unknown', mergeableReason: reason });

/**
 * Whether the local `git` understands `merge-tree --write-tree`.
 *
 * Git older than 2.38 has a different `merge-tree` that answers a different
 * question (a three-way file diff) and exits 0 regardless, so an old version
 * must never reach the exit-code mapping below — it would report every PR
 * `mergeable`.
 *
 * @param version - `git --version`'s stdout, or `''` where it could not run.
 * @returns whether this git answers `merge-tree --write-tree` honestly.
 */
export const gitSupportsMergeTree = (version: string): boolean => {
  const match = /^git version (\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 38);
};

/**
 * The Bitbucket `mergeable` reading for one PR, from a local `git merge-tree
 * --write-tree <base> <head>` check.
 *
 * Bitbucket Cloud's REST API has no field or endpoint that reports
 * merge-conflict status (measured 2026-10-20), so this reads the object
 * database instead — the same check `trees-git.ts`'s `mergeConflict` runs for
 * the desk's own worktree, here run per Bitbucket PR against its base and
 * head.
 *
 * Only exit 0 and exit 1 are trusted. Anything else — a missing head or base,
 * a failed fetch of the base, a head commit absent from the clone, old git, an
 * unreadable git — answers `unknown` with a named reason rather than guessing.
 * `merge-tree --write-tree` reads the object database only; it writes neither
 * the index nor a worktree.
 *
 * @param input.headSha - the PR's head commit, or `''` where the host gave none.
 * @param input.baseRef - the local ref naming the base (e.g. `origin/main`),
 *   or `''` where the pull request names no base.
 * @param input.gitVersion - `git --version`'s stdout.
 * @param input.baseFetched - whether `git fetch` of the base succeeded; absent
 *   where no fetch was attempted. `false` answers `unknown`, because the local
 *   base ref may be stale.
 * @param input.headInClone - whether the head commit exists in the local
 *   object database; absent where it was not checked.
 * @param input.mergeTree - the `git merge-tree --write-tree` invocation's
 *   result, run only when every check above passed; absent otherwise.
 * @returns the reading.
 */
export const bitbucketMergeable = (input: {
  headSha: string;
  baseRef: string;
  gitVersion: string;
  baseFetched?: boolean;
  headInClone?: boolean;
  mergeTree?: { code: number | null; stderr?: string };
}): MergeableReading => {
  if (input.headSha === '') return UNKNOWN('no head commit for this pull request');
  if (input.baseRef === '') return UNKNOWN('no base branch for this pull request');
  if (input.baseFetched === false) return UNKNOWN(`fetching ${input.baseRef} failed, so the local base may be stale`);
  if (input.headInClone === false) return UNKNOWN(`head commit ${input.headSha} is not in the local clone`);
  if (!gitSupportsMergeTree(input.gitVersion)) return UNKNOWN('git older than 2.38 cannot answer merge-tree --write-tree');
  if (input.mergeTree === undefined) return UNKNOWN('merge-tree was not run');
  if (input.mergeTree.code === 0) return { mergeable: 'mergeable' };
  if (input.mergeTree.code === 1) return { mergeable: 'conflicting' };
  const detail = (input.mergeTree.stderr ?? '').trim();
  return UNKNOWN(detail === '' ? 'merge-tree exited abnormally' : detail);
};

/**
 * A Bitbucket `pr-state`/`pr-list` row with its `mergeable` reading folded in.
 *
 * Only an `OPEN` row takes the reading. A `MERGED` or `CLOSED` row is settled,
 * and a `NONE` row has no pull request, so each returns unchanged: `merge-tree`
 * answers "would this merge now", which no settled or absent PR asks.
 *
 * @param row - the row as the host answered it, with its `state`.
 * @param input - the readings `bitbucketMergeable` takes.
 * @returns the row, with `mergeable` (and `mergeableReason`) replaced where it is `OPEN`.
 */
export const foldBitbucketMergeable = <Row extends { state?: unknown }>(
  row: Row,
  input: Parameters<typeof bitbucketMergeable>[0],
): Row | (Row & MergeableReading) => (row.state === 'OPEN' ? { ...row, ...bitbucketMergeable(input) } : row);
