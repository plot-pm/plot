import {
  agentsFs,
  hostShell,
  planParserPath,
  planStoreRef,
  planStoreShell,
  processesFiles,
  refsGit,
  scriptsShell,
  treesGit,
} from '@plot-pm/domain/adapters';
import { emptySnapshot, type Readings, type RepoSnapshot } from '@plot-pm/domain/entities/snapshot';
import { freshWalkCache, type WalkCache } from '@plot-pm/domain/workflows/plan-walk-cache';
import type { RecordReading } from '@plot-pm/fleet/shared/snapshot-fill';
import { walkOnce } from '@plot-pm/fleet/shared/fleet-scan';

/**
 * The snapshot fleetd records for a repository: one in-process plan walk over
 * the same ports `registryd-main.ts` hands `fleetScan`, with every reading it
 * records kept.
 *
 * @param repoRoot - the repository to walk.
 * @param scriptsDir - the scripts the walk and its adapters run.
 * @param options - the walk cache to keep across passes, as fleetd keeps one;
 *   `record: false` for a walk that records nothing; the generation to stamp.
 * @returns the snapshot, at generation 1 by default. A walk that throws after recording
 *   keeps what it recorded.
 */
export const servedSnapshotOf = async (
  repoRoot: string,
  scriptsDir: string,
  options: { cache?: WalkCache; record?: boolean; generation?: number } = {},
): Promise<RepoSnapshot> => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const readings: Readings = { ...emptySnapshot().readings };
  const record: RecordReading = (key, reading) => {
    (readings as Record<string, unknown>)[key] = reading;
  };
  try {
    await walkOnce(
      {
        repoRoot,
        scripts: scriptsShell(context),
        refs: refsGit(context),
        backend: async () => {
          const answer = await hostShell(context).backend();
          return answer.ok ? answer.value : 'github';
        },
        ...(options.record === false ? {} : { record }),
        walk: {
          host: hostShell(context),
          plans: (ref, planDir) => planStoreRef(refsGit(context), context, ref, planDir),
          worktree: planStoreShell(context),
          trees: treesGit(context),
          agents: agentsFs(context),
          processes: processesFiles(context, { log: () => undefined }),
          parser: planParserPath(context),
          prIndexRows: async () => [],
        },
      },
      '',
      '',
      options.cache ?? freshWalkCache(),
    );
  } catch {
    // The walk records each reading as it reads it; a later stage that fails keeps them.
  }
  return { generation: options.generation ?? 1, readings };
};
