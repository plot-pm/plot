import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { DEFAULT_RELEASE_DIR, syncPathSet } from '@plot-pm/domain/rules/state-sync';
import { writeTarget, type StateWriteTarget } from '@plot-pm/domain/rules/write-target';

/** What the sync PR path gate needs, built once from the config. */
export interface StateSyncGate {
  target: StateWriteTarget;
  pathSet: readonly string[];
  defaultBranch: string;
  /**
   * The paths the sync PR changes at head `sha`, read after fetching both the
   * state ref and the default branch; `'unknown'` where any fetch or read
   * failed or the state tip is not `sha`.
   */
  diff: (sha: string) => Promise<readonly string[] | 'unknown'>;
}

/**
 * Builds the sync PR gate for a repository.
 *
 * @param config - reads a `## Plot Config` key with a fallback.
 * @param deps - the refs and trees ports and the repository root.
 * @returns the gate; null where no `State branch` key is declared, the key is
 *   invalid, the state ref is not a branch, or the default branch is unread —
 *   the callers then behave as they did before the key existed.
 */
export const stateSyncGateFor = async (
  config: (key: string, fallback: string) => Promise<string>,
  deps: { refs: Pick<Refs, 'defaultBranch' | 'resolve' | 'changedFiles'>; trees: Pick<Trees, 'fetchRef'>; repoRoot: string },
): Promise<StateSyncGate | null> => {
  const main = await deps.refs.defaultBranch();
  if (!main.ok) return null;
  const target = writeTarget(await config('State branch', ''), main.value);
  if (target.kind !== 'state' || !target.isBranch) return null;
  const pathSet = syncPathSet({
    planDir: await config('Plan directory', 'docs/plans/'),
    activeIndex: await config('Active index', 'docs/plans/active/'),
    deliveredIndex: await config('Delivered index', 'docs/plans/delivered/'),
    sprintDir: await config('Sprint directory', 'docs/sprints/'),
    releaseDir: DEFAULT_RELEASE_DIR,
  });
  return {
    target,
    pathSet,
    defaultBranch: main.value,
    diff: async (sha) => {
      const fetched = await deps.trees.fetchRef(deps.repoRoot, target.pushRef, target.trackRef);
      if (!fetched.ok || !fetched.value) return 'unknown';
      const defaults = await deps.trees.fetchRef(deps.repoRoot, `refs/heads/${main.value}`, target.defaultRef);
      if (!defaults.ok || !defaults.value) return 'unknown';
      const tip = await deps.refs.resolve(target.trackRef);
      if (!tip.ok || tip.value === '' || !(tip.value.startsWith(sha) || sha.startsWith(tip.value))) return 'unknown';
      const files = await deps.refs.changedFiles(target.trackRef, main.value);
      return files.ok ? files.value : 'unknown';
    },
  };
};
