/**
 * The sync pull request and the forward-sync readings, gathered through ports.
 *
 * Every decision is {@link syncPrDecision} or {@link forwardSync} over values
 * read here. A read that fails becomes `'unknown'` or null and is never turned
 * into "no pull request" or "nothing to sync".
 *
 * @concept state-sync
 */
import type { Host } from '../ports/host.js';
import type { ReaderLock } from '../ports/reader-lock.js';
import type { Refs } from '../ports/refs.js';
import type { StateSyncRecord } from '../ports/state-sync-record.js';
import { heartbeatIsFresh } from '../rules/reader-election.js';
import { statusStateOf } from '../rules/state-transition.js';
import {
  SYNC_PR_MARKER,
  aheadSinceTreeEqual,
  forwardSync,
  isSyncHead,
  standingConflictFiles,
  syncPrBody,
  syncPrDecision,
  syncPrTitle,
  type ForwardRefusal,
  type ForwardSyncDecision,
  type SyncCaller,
  type SyncPrDecision,
} from '../rules/state-sync.js';
import type { StateWriteTarget } from '../rules/write-target.js';

/** Where the state ref and the plans live. */
export interface StateSyncSource {
  readonly target: StateWriteTarget;
  readonly defaultBranch: string;
  /** The `Plan directory` value, with a trailing slash. */
  readonly planDir: string;
}

/** The ports one sync read or act needs. */
export interface StateSyncPorts {
  readonly host: Pick<Host, 'prListing' | 'prState' | 'prCreate' | 'prComment'>;
  readonly refs: Pick<Refs, 'commitSubjects' | 'firstParentCommits' | 'changedFiles' | 'showFile' | 'fileExistsSync' | 'resolve'>;
  /** The last refresh this machine posted; a refresh the host took is recorded here. */
  readonly record: Pick<StateSyncRecord, 'refreshed' | 'noteRefresh'>;
}

/**
 * Counts the commits `from` holds that `to` lacks.
 *
 * @returns the count; null where the range could not be read.
 */
export const commitsBetween = async (refs: Pick<Refs, 'commitSubjects'>, to: string, from: string): Promise<number | null> => {
  const range = await refs.commitSubjects(`${to}..${from}`);
  return range.ok ? range.value.length : null;
};

/**
 * Counts the commits `trackRef` holds that `defaultRef` does not yet hold in content.
 *
 * Reads the state branch's first-parent line, the default tip's tree and the
 * trees of the default branch's first-parent commits since the state line's
 * oldest commit forked, then asks {@link aheadSinceTreeEqual}. Every reader of
 * the ahead count calls this.
 *
 * @returns the count; null where a read fails. An empty line reads 0.
 */
export const commitsAhead = async (
  refs: Pick<Refs, 'firstParentCommits' | 'resolve'>,
  defaultRef: string,
  trackRef: string,
): Promise<number | null> => {
  const line = await refs.firstParentCommits(`${defaultRef}..${trackRef}`);
  if (!line.ok) return null;
  const oldest = line.value[line.value.length - 1];
  if (oldest === undefined) return 0;
  const [tree, landed] = await Promise.all([
    refs.resolve(`${defaultRef}^{tree}`),
    refs.firstParentCommits(`${oldest.sha}^..${defaultRef}`),
  ]);
  if (!tree.ok || !landed.ok) return null;
  return aheadSinceTreeEqual(line.value, [tree.value, ...landed.value.map((commit) => commit.tree)]);
};

/** How many open PRs {@link openSyncPr} asks the host for, by the state branch's head. */
export const SYNC_PR_LIMIT = 100;

const HEADS = 'refs/heads/';

/**
 * Finds the open sync pull request.
 *
 * Asks the host for the open PRs whose head is the state branch, then takes
 * the first one whose base is the default branch. A row that names no base
 * is read again through `prState`, which names it.
 *
 * @param host - the host port.
 * @param source - the state target and the default branch.
 * @returns its number; null where the host answered whole with none, or the
 *   state ref is not a branch; `'unknown'` where the listing did not answer in
 *   full, a base lookup failed, or the listing filled {@link SYNC_PR_LIMIT}
 *   rows with no sync PR among them.
 */
export const openSyncPr = async (host: Pick<Host, 'prListing' | 'prState'>, source: StateSyncSource): Promise<number | null | 'unknown'> => {
  if (!source.target.isBranch) return null;
  const head = source.target.pushRef.slice(HEADS.length);
  const listed = await host.prListing({ state: 'open', branches: [head], limit: SYNC_PR_LIMIT });
  if (listed.answer !== 'answered') return 'unknown';
  for (const row of listed.rows) {
    const number = row.number;
    if (typeof number !== 'number' || row.state !== 'OPEN' || !isSyncHead(String(row.head), source.target)) continue;
    let base = typeof row.base === 'string' ? row.base : '';
    if (base === '') {
      const looked = await host.prState(number);
      if (!looked.ok) return 'unknown';
      base = looked.value?.base ?? '';
    }
    if (base === source.defaultBranch) return number;
  }
  return listed.rows.length < SYNC_PR_LIMIT ? null : 'unknown';
};

const isDelivered = (text: string): boolean => statusStateOf(text).toLowerCase().startsWith('delivered');
const isBooked = (text: string): boolean => /^(delivered|released)/.test(statusStateOf(text).toLowerCase());

/**
 * Whether a plan reached Delivered on the state ref that the default branch does not hold as Delivered or Released.
 *
 * @returns the answer; `'unknown'` where a diff or a file read failed.
 */
export const deliveredPending = async (refs: StateSyncPorts['refs'], source: StateSyncSource): Promise<boolean | 'unknown'> => {
  const { target, defaultBranch, planDir } = source;
  const changed = await refs.changedFiles(target.trackRef, defaultBranch);
  if (!changed.ok) return 'unknown';
  const plans = changed.value.filter((file) => file.startsWith(planDir) && file.endsWith('.md') && !file.slice(planDir.length).includes('/'));
  for (const plan of plans) {
    const state = await refs.showFile(target.trackRef, plan);
    if (!state.ok) return 'unknown';
    if (!isDelivered(state.value)) continue;
    const there = refs.fileExistsSync(target.defaultRef, plan);
    if (!there.ok) return 'unknown';
    if (!there.value) return true;
    const base = await refs.showFile(target.defaultRef, plan);
    if (!base.ok) return 'unknown';
    if (!isBooked(base.value)) return true;
  }
  return false;
};

/** What one sync pull request pass did. */
export type SyncPrResult =
  | { readonly done: 'opened'; readonly url: string }
  | { readonly done: 'refreshed'; readonly pr: number }
  | { readonly done: 'none'; readonly reason: string }
  | { readonly done: 'unknown'; readonly reason: string }
  | { readonly done: 'failed'; readonly why: string };

/**
 * Opens the sync pull request, refreshes the open one, or does nothing.
 *
 * The host is asked for an open sync pull request first, so a second pass
 * refreshes the first one's pull request and never opens another. A refresh
 * replaces the marked comment, and only where the count ahead differs from the
 * last recorded refresh; the pull request's head already carries the new
 * commits. An unreadable record reads as no refresh: the edit it costs lands
 * on the same marked comment.
 *
 * @param ports - the host, the refs and the refresh record.
 * @param source - the target, the default branch and the plan directory.
 * @param caller - fleetd, or the command that wrote Delivered.
 * @param fleetLive - whether a fleet heartbeat is live; `'unknown'` where unread. Read only for the command caller.
 */
export const syncPrAt = async (
  ports: StateSyncPorts,
  source: StateSyncSource,
  caller: SyncCaller,
  fleetLive: boolean | 'unknown',
): Promise<SyncPrResult> => {
  const open = source.target.isBranch ? await openSyncPr(ports.host, source) : null;
  const pending = source.target.isBranch ? await deliveredPending(ports.refs, source) : false;
  const ahead = source.target.isBranch ? await commitsAhead(ports.refs, source.target.defaultRef, source.target.trackRef) : 0;
  const said = open !== null && open !== 'unknown' ? await ports.record.refreshed() : null;
  const refreshed = said !== null && said.ok ? said.value : null;
  const decision: SyncPrDecision = syncPrDecision({ caller, target: source.target, deliveredPending: pending, ahead, open, fleetLive, refreshed });
  const branch = source.target.pushRef.replace(/^refs\/heads\//, '');
  if (decision.kind === 'none') return { done: 'none', reason: decision.reason };
  if (decision.kind === 'unknown') return { done: 'unknown', reason: decision.reason };
  // `syncPrDecision` answers `unknown` (`ahead-unread`) for every unread count before it opens or refreshes.
  const count = ahead as number;
  const body = syncPrBody(count, branch, source.defaultBranch);
  if (decision.kind === 'refresh') {
    const posted = await ports.host.prComment(decision.pr, body, SYNC_PR_MARKER);
    if (!posted.ok) return { done: 'failed', why: `the host did not take the refresh comment on PR #${decision.pr}` };
    await ports.record.noteRefresh({ pr: decision.pr, ahead: count });
    return { done: 'refreshed', pr: decision.pr };
  }
  const created = await ports.host.prCreate({
    head: branch,
    base: source.defaultBranch,
    title: syncPrTitle(branch, source.defaultBranch),
    body,
    draft: false,
  });
  return created.ok ? { done: 'opened', url: created.value } : { done: 'failed', why: 'the host did not open the sync pull request' };
};

/** What the forward-sync tick reads from the world, as values. */
export interface ForwardReadings {
  readonly lockHeld: boolean | 'unknown';
  readonly refused: ForwardRefusal | null;
}

/**
 * Reads the two tips and the behind count, and decides the forward merge.
 *
 * @param refs - the refs port; the tips are the fetched tracking refs.
 * @param target - the state target (a branch or a non-branch ref).
 * @param world - the lock and the remembered refusal.
 * @returns the decision and the tips it read.
 */
export const forwardSyncAt = async (
  refs: Pick<Refs, 'commitSubjects' | 'resolve'>,
  target: StateWriteTarget,
  world: ForwardReadings,
): Promise<{ decision: ForwardSyncDecision; defaultTip: string; stateTip: string }> => {
  const [def, state, behind] = await Promise.all([
    refs.resolve(target.defaultRef),
    refs.resolve(target.trackRef),
    commitsBetween(refs, target.trackRef, target.defaultRef),
  ]);
  const defaultTip = def.ok && def.value !== '' ? def.value : 'unknown';
  const stateTip = state.ok && state.value !== '' ? state.value : 'unknown';
  return { decision: forwardSync({ behind, defaultTip, stateTip, lockHeld: world.lockHeld, refused: world.refused }), defaultTip, stateTip };
};

const tipAt = async (refs: Pick<Refs, 'resolve'>, ref: string): Promise<string> => {
  const read = await refs.resolve(ref);
  return read.ok && read.value !== '' ? read.value : 'unknown';
};

/**
 * Reads the two current tips and answers the files of a recorded conflict that still stands.
 *
 * @param refs - the refs port; the tips are the fetched tracking refs.
 * @param target - the state target.
 * @param known - the recorded conflict; null for none.
 * @returns the files from {@link standingConflictFiles}; empty where a tip could not be read.
 */
export const standingConflictAt = async (
  refs: Pick<Refs, 'resolve'>,
  target: StateWriteTarget,
  known: ForwardRefusal | null,
): Promise<readonly string[]> => {
  if (known === null) return [];
  const [defaultTip, stateTip] = await Promise.all([tipAt(refs, target.defaultRef), tipAt(refs, target.trackRef)]);
  return standingConflictFiles(known, defaultTip, stateTip);
};

/**
 * Whether a fleetd heartbeat is live for a repository.
 *
 * @param lock - the reader lock port.
 * @param backend - the host backend word, which keys the lock.
 * @param now - the clock reading in milliseconds.
 * @returns true where a heartbeat named `fleetd` is fresh; `'unknown'` where the heartbeats could not be read.
 */
export const fleetLiveAt = async (lock: Pick<ReaderLock, 'heartbeats'>, backend: string, now: number): Promise<boolean | 'unknown'> => {
  const read = await lock.heartbeats(backend);
  if (!read.ok) return 'unknown';
  return read.value.some((beat) => beat.name === 'fleetd' && heartbeatIsFresh(beat.at, now));
};
