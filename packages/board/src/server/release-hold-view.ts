import { IN_PROCESS_BACKENDS } from '@plot-pm/domain/adapters';
import type { PrIndex } from '@plot-pm/domain/entities/pr-index';
import type { ReleaseHoldView } from '@plot-pm/domain/entities/release-hold-person';
import { releaseHoldView, releaseRowOf, releasePersonHold } from '@plot-pm/domain/rules/release-hold-person';
import { realEstate, type EstateOptions } from './estate.js';
import { releaseHoldPersonIn, stateHomeFor } from './state-home.js';

/**
 * The person hold of a release as the board payload carries it.
 *
 * Reads the PR index of each backend in `IN_PROCESS_BACKENDS`, the default
 * branch's name and the person hold file. It starts no process to ask the
 * backend word: exactly one connector's index must exist. It reads the release
 * head's changes only where a release row exists and no hold holds, because only
 * the Hold button reads them.
 *
 * @param opts - the board's estate options.
 * @param checksWaitMs - the hold's length, `Checks wait`.
 * @param now - epoch milliseconds.
 * @returns the view, or `undefined` where a read failed, or where no PR index or more than one exists. Absent never means "no hold".
 */
export const releaseHoldViewFor = async (opts: EstateOptions, checksWaitMs: number, now: number = Date.now()): Promise<ReleaseHoldView | undefined> => {
  const estate = realEstate(opts);
  const indexes: PrIndex[] = [];
  for (const connector of IN_PROCESS_BACKENDS) {
    const read = await estate.prIndex.read(connector);
    if (!read.ok) return undefined;
    if (read.value !== null) indexes.push(read.value);
  }
  if (indexes.length !== 1) return undefined;
  const index = indexes[0];
  const name = await estate.refs.defaultBranch();
  if (!name.ok) return undefined;
  const record = await releaseHoldPersonIn(stateHomeFor(opts)).read();
  if (!record.ok) return undefined;
  const rows = index.rows;
  const branch = name.value.trim();
  const row = releaseRowOf(rows, branch);
  const holds = releasePersonHold(rows, record.value, branch, now, checksWaitMs).holds;
  const changes = row === null || holds || row.headSha === undefined ? null : await estate.refs.headChanges(row.headSha);
  const headChanges = changes === null ? null : changes.ok ? changes.value : 'unaskable';
  return releaseHoldView(rows, record.value, branch, now, checksWaitMs, headChanges);
};
