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
  forwardSync,
  isSyncPr,
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
  readonly host: Pick<Host, 'prList' | 'prCreate' | 'prComment'>;
  readonly refs: Pick<Refs, 'commitSubjects' | 'changedFiles' | 'showFile' | 'fileExistsSync' | 'resolve'>;
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
 * Finds the open sync pull request.
 *
 * @returns its number; null where the host answered with none; `'unknown'`
 *   where the ask failed.
 */
export const openSyncPr = async (host: Pick<Host, 'prList'>, source: StateSyncSource): Promise<number | null | 'unknown'> => {
  const listed = await host.prList('open', 100);
  if (!listed.ok) return 'unknown';
  return listed.value.find((pr) => pr.state === 'OPEN' && isSyncPr(pr, source.target, source.defaultBranch))?.number ?? null;
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
  const ahead = source.target.isBranch ? await commitsBetween(ports.refs, source.target.defaultRef, source.target.trackRef) : 0;
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
