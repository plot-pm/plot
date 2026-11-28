import type { ReleaseHoldView } from '@plot-pm/domain/entities/release-hold-person';
import { releaseHoldView, releaseRowOf, releasePersonHold } from '@plot-pm/domain/rules/release-hold-person';
import { realEstate, type EstateOptions } from './estate.js';
import { releaseHoldPersonIn, stateHomeFor } from './state-home.js';

/**
 * The person hold of a release as the board payload carries it.
 *
 * Reads the git host's backend word, the PR index, the default branch's name and
 * the person hold file. It reads the release head's changes only where a release
 * row exists and no hold holds, because only the Hold button reads them.
 *
 * @param opts - the board's estate options.
 * @param checksWaitMs - the hold's length, `Checks wait`.
 * @param now - epoch milliseconds.
 * @returns the view, or `undefined` where a read failed or no PR index exists. Absent never means "no hold".
 */
export const releaseHoldViewFor = async (opts: EstateOptions, checksWaitMs: number, now: number = Date.now()): Promise<ReleaseHoldView | undefined> => {
  const estate = realEstate(opts);
  const backend = await estate.host.backend();
  if (!backend.ok) return undefined;
  const index = await estate.prIndex.read(backend.value);
  if (!index.ok || index.value === null) return undefined;
  const name = await estate.refs.defaultBranch();
  if (!name.ok) return undefined;
  const record = await releaseHoldPersonIn(stateHomeFor(opts)).read();
  if (!record.ok) return undefined;
  const rows = index.value.rows;
  const branch = name.value.trim();
  const row = releaseRowOf(rows, branch);
  const holds = releasePersonHold(rows, record.value, branch, now, checksWaitMs).holds;
  const changes = row === null || holds || row.headSha === undefined ? null : await estate.refs.headChanges(row.headSha);
  const headChanges = changes === null ? null : changes.ok ? changes.value : 'unaskable';
  return releaseHoldView(rows, record.value, branch, now, checksWaitMs, headChanges);
};
