import { userInfo } from 'node:os';
import { prIndexFile } from '@plot-pm/domain/adapters';
import { checksWaitMsOf } from '@plot-pm/domain/rules/default-branch';
import type { Caller } from '@plot-pm/domain/workflows/decision';
import type { ReleaseHoldPorts } from '@plot-pm/domain/workflows/release-hold';
import { readConfigAsync, type BuildBoardOptions } from '../board.js';
import { realEstate } from '../estate.js';
import { releaseHoldPersonIn, stateHomeFor } from '../state-home.js';

export { releaseHoldAt, releaseHoldLiftAt, type ReleaseHoldResult } from '@plot-pm/domain/workflows/release-hold';

/**
 * The person's name a hold records as `by`.
 *
 * @param who - the name the caller gave; empty or absent reads the login name.
 * @returns the name.
 */
export const holdWho = (who: string | undefined): string => {
  const given = who?.trim() ?? '';
  if (given !== '') return given;
  try {
    return userInfo().username;
  } catch {
    return 'person';
  }
};

/**
 * The ports `releaseHoldAt` and `releaseHoldLiftAt` take, over the real estate.
 *
 * @param opts - the board options the entry resolved.
 * @param caller - who is asking.
 * @param who - the person's name the record carries.
 * @returns the ports.
 */
export const releaseHoldPortsFor = async (opts: BuildBoardOptions, caller: Caller, who: string): Promise<ReleaseHoldPorts> => {
  const estate = realEstate(opts);
  return {
    caller,
    who,
    store: releaseHoldPersonIn(stateHomeFor(opts)),
    rows: async () => {
      const backend = await estate.host.backend();
      if (!backend.ok) return backend;
      const held = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
      return held.ok ? { ok: true, value: held.value?.rows ?? null } : held;
    },
    defaultBranchName: async () => {
      const name = await estate.refs.defaultBranch();
      return name.ok ? { ok: true, value: name.value.trim() } : name;
    },
    headChanges: async (sha) => {
      const changes = await estate.refs.headChanges(sha);
      return changes.ok ? changes.value : 'unaskable';
    },
    checksWaitMs: checksWaitMsOf(await readConfigAsync(opts, 'Checks wait', '3600')),
    now: Date.now,
  };
};
