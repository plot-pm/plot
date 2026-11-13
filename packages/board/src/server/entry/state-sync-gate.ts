import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { PortResult } from '@plot-pm/domain';
import { DEFAULT_RELEASE_DIR, syncPathSet, type UnreadSyncGate } from '@plot-pm/domain/rules/state-sync';
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
 * @param config - reads a `## Plot Config` key; a failed read is a failed result.
 * @param deps - the refs and trees ports and the repository root.
 * @returns the gate; an {@link UnreadSyncGate} where the `State branch` key
 *   could not be read, or where it names a branch and the default branch could
 *   not be read; null where no key is declared, the key is invalid, or the
 *   state ref is not a branch — the callers then behave as they did before the
 *   key existed. A failed read of any other key falls back to its default.
 */
export const stateSyncGateFor = async (
  config: (key: string, fallback: string) => Promise<PortResult<string>>,
  deps: { refs: Pick<Refs, 'defaultBranch' | 'resolve' | 'changedFiles'>; trees: Pick<Trees, 'fetchRef'>; repoRoot: string },
): Promise<StateSyncGate | UnreadSyncGate | null> => {
  const key = await config('State branch', '');
  const main = await deps.refs.defaultBranch();
  if (!key.ok) return { unread: 'state-branch-key', target: 'unknown', defaultBranch: main.ok ? main.value : 'unknown' };
  const named = writeTarget(key.value, main.ok ? main.value : '');
  if (named.kind !== 'state' || !named.isBranch) return null;
  if (!main.ok) return { unread: 'default-branch', target: named, defaultBranch: 'unknown' };
  const target = named;
  const keyed = async (name: string, fallback: string): Promise<string> => {
    const read = await config(name, fallback);
    return read.ok ? read.value : fallback;
  };
  const pathSet = syncPathSet({
    planDir: await keyed('Plan directory', 'docs/plans/'),
    activeIndex: await keyed('Active index', 'docs/plans/active/'),
    deliveredIndex: await keyed('Delivered index', 'docs/plans/delivered/'),
    sprintDir: await keyed('Sprint directory', 'docs/sprints/'),
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
