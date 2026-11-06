import type { Host } from '../ports/host.js';
import type { Trees } from '../ports/trees.js';

/** The ports {@link unpushedAfterMerge} reads. */
export interface UnpushedAfterMergePorts {
  readonly trees: Pick<Trees, 'unpushedCommits' | 'unpushedPatches'>;
  readonly host: Pick<Host, 'prMergedHeads'>;
  /** Whether `sha` names a commit the checkout at `worktree` holds. */
  readonly holdsCommit: (worktree: string, sha: string) => Promise<boolean>;
}

/**
 * Commits on a checkout's `HEAD` that no remote holds, short SHAs, or
 * `'unknown'` where they could not be counted.
 *
 * For a merged branch, a commit reachable from a merged PR's head counts as
 * pushed: a squash or rebase merge rewrites the commits, and the host then
 * deletes the branch, so a `fetch --prune` removes the one remote ref that
 * held them. Where the checkout holds none of the merged heads, the reading
 * compares by patch id against `origin/<defaultBranch>` instead. Every failed
 * reading, the host's included, answers `'unknown'`.
 *
 * @param merged whether the host merged a PR for `branch`; `false` answers the
 *   plain `HEAD --not --remotes` range.
 */
export const unpushedAfterMerge = async (
  ports: UnpushedAfterMergePorts,
  worktree: string,
  branch: string,
  merged: boolean,
  defaultBranch: string,
): Promise<readonly string[] | 'unknown'> => {
  const plain = await ports.trees.unpushedCommits(worktree, []);
  if (!plain.ok) return 'unknown';
  if (plain.value.length === 0) return [];
  if (branch === '' || !merged) return plain.value;

  const heads = await ports.host.prMergedHeads(branch);
  if (!heads.ok) return 'unknown';

  const reachable: string[] = [];
  for (const head of heads.value) {
    if (await ports.holdsCommit(worktree, head)) reachable.push(head);
  }

  const reading =
    reachable.length > 0
      ? await ports.trees.unpushedCommits(worktree, reachable)
      : await ports.trees.unpushedPatches(worktree, `origin/${defaultBranch}`);
  return reading.ok ? reading.value : 'unknown';
};
