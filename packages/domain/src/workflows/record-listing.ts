import { answered, type PortResult } from '../port-result.js';
import type { Refs, TreeBlob } from '../ports/refs.js';
import { recordRef, stateTrackRef, unionBlobs, type RecordRef } from '../rules/record-ref.js';

/** Where plan records live: the `State branch` key and the default branch. */
export interface RecordSource {
  /** The value of `State branch` as configured; empty where absent. */
  readonly stateBranch: string;
  /** The default branch's short name. */
  readonly defaultBranch: string;
}

/**
 * Resolves which ref holds the records, from the clone's own refs.
 *
 * A state ref that does not resolve, and a read that fails, both answer
 * `default`: absent is not false, and neither reads as "no plans".
 *
 * @param refs - the ref reader.
 * @param source - the key and the default branch.
 * @returns the rule's answer.
 */
export const resolveRecordRef = async (refs: Refs, source: RecordSource): Promise<RecordRef> => {
  const track = stateTrackRef(source.stateBranch, source.defaultBranch);
  if (track === null) return recordRef(source.stateBranch, source.defaultBranch, false);
  const tip = await refs.resolve(`${track}^{commit}`);
  return recordRef(source.stateBranch, source.defaultBranch, tip.ok && tip.value !== '');
};

/**
 * Lists the plan blobs beneath `dir` as the union of the state ref and the default branch.
 *
 * With no key, or no state ref in the clone, this is one `listBlobs` of
 * `defaultSha`, the call a reader made before the key existed. The state ref's
 * entry wins per path; a state listing that cannot be read leaves the default
 * branch's listing standing.
 *
 * @param refs - the ref reader.
 * @param source - the key and the default branch.
 * @param defaultSha - the default branch's commit the caller resolved.
 * @param dir - the directory to list beneath.
 * @returns the union, or a failure where the default branch cannot be listed.
 */
export const listRecordBlobs = async (
  refs: Refs,
  source: RecordSource,
  defaultSha: string,
  dir: string,
): Promise<PortResult<readonly TreeBlob[]>> => {
  const defaults = await refs.listBlobs(defaultSha, dir);
  if (!defaults.ok) return defaults;
  const where = await resolveRecordRef(refs, source);
  if (where.kind !== 'state') return defaults;
  const state = await refs.listBlobs(where.ref, dir);
  if (!state.ok) return answered(defaults.value);
  return answered(unionBlobs(state.value, defaults.value));
};

/**
 * Counts the commits the state ref holds that the default branch lacks.
 *
 * @param refs - the ref reader.
 * @param source - the key and the default branch.
 * @returns the count; 0 where no state ref is in play; null where it could not be read.
 */
export const recordsAhead = async (refs: Refs, source: RecordSource): Promise<number | null> => {
  const where = await resolveRecordRef(refs, source);
  if (where.kind !== 'state') return 0;
  const range = await refs.commitSubjects(`${where.defaultRef}..${where.ref}`);
  return range.ok ? range.value.length : null;
};


/**
 * Names the ref a path's records are read at.
 *
 * @param refs - the ref reader.
 * @param source - the key and the default branch.
 * @param path - a repository-relative path; absent, the ref a listing starts from.
 * @returns the state ref's local tip where one is in play and holds `path`
 *   (or `path` is absent); `origin/<default>` otherwise. A failed presence
 *   read answers the default branch: absent is not false.
 */
export const readRefFor = async (refs: Refs, source: RecordSource, path?: string): Promise<string> => {
  const where = await resolveRecordRef(refs, source);
  if (where.kind !== 'state') return `origin/${source.defaultBranch}`;
  if (path === undefined) return where.ref;
  const held = refs.fileExistsSync(where.ref, path);
  return held.ok && held.value ? where.ref : `origin/${source.defaultBranch}`;
};
