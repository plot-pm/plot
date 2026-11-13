import { scriptsFor, readConfigAsync, type BuildBoardOptions } from '../board.js';
import { realEstate } from '../estate.js';
import { checkNamesOf, checksWaitMsOf } from '@plot-pm/domain/rules/default-branch';
import { buildShell } from '@plot-pm/domain/adapters/build/build-resolve';
import { repairRecordFile } from '@plot-pm/domain/adapters/repair-record/repair-record-file';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { callerOf, type Caller } from '@plot-pm/domain/workflows/decision';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { MergePorts } from './merge.js';
import { stateSyncGateFor } from './state-sync-gate.js';
import type { FinishContext } from './release-finish.js';

/**
 * The ports `mergeAt` takes, for the two board-free arms that merge.
 *
 * The estate is the REAL one, whatever `PLOT_BOARD_MOCK` says: the merge reaches
 * the real host through `plot-host.sh`, so it reads the real default-branch
 * reading. A mock estate's null fixture would lift the red-main refusal on a
 * merge that still lands. The estate's `refsGit` answers `remoteSha` as
 * `unaskable`; `mergeAt` reads the default branch's tip through it on a settled
 * reading, so the tip comes from `refsRemoteGit` over `git ls-remote`, as
 * `design.ts` composes it.
 *
 * @param opts - the board options the entry resolved.
 * @param caller - who is asking; read from `PLOT_UNATTENDED` where absent. A board
 *   route that verified a passkey assertion passes `person`.
 * @returns the ports.
 */
export const mergePortsFor = async (
  opts: BuildBoardOptions,
  caller: Caller = callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' }),
): Promise<MergePorts> => {
  const estate = realEstate(opts);
  const remote = refsRemoteGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
  const trees = treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
  const refs = { ...estate.refs, remoteSha: remote.remoteSha };
  const stateSync = await stateSyncGateFor((key, fallback) => readConfigAsync(opts, key, fallback), { refs, trees, repoRoot: opts.repoRoot });
  return {
    ...(stateSync ? { stateSync } : {}),
    host: estate.host,
    scripts: scriptsFor(opts),
    defaultBranch: estate.defaultBranch,
    refs,
    checksWaitMs: checksWaitMsOf(await readConfigAsync(opts, 'Checks wait', '3600')),
    now: Date.now,
    // The repair exception on a red default branch: the record, and the
    // CI connector that asks the red commit's runs again.
    repair: repairRecordFile(opts.repoRoot),
    build: await buildShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    checks: checkNamesOf(await readConfigAsync(opts, 'Default branch checks', '')),
    mergeChecks: checkNamesOf(await readConfigAsync(opts, 'Merge checks', '')),
    // No in-process fleetd caller reaches this entrance yet — `PLOT_UNATTENDED`
    // maps to 'unattended', never to 'fleetd'.
    caller,
  };
};


/**
 * What `finishRelease` reads and writes through, over the ports a release
 * approval just used.
 *
 * @param opts - the board options the entry resolved.
 * @param ports - the ports {@link mergePortsFor} built.
 * @returns the finish's context; its caller is the approval's.
 */
export const finishContextFor = (opts: BuildBoardOptions, ports: MergePorts): FinishContext => {
  const estate = realEstate(opts);
  return {
    repoRoot: opts.repoRoot,
    refs: estate.refs,
    host: estate.host,
    planStore: estate.planStore,
    scripts: ports.scripts,
    trees: treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    scriptDir: opts.scriptsDir,
    caller: ports.caller,
    tagWaitMs: ports.checksWaitMs,
    pollMs: 15_000,
  };
};
