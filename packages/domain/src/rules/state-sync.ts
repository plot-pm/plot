/**
 * The sync between the state ref and the default branch.
 *
 * Two directions, each a decision over readings taken as values:
 *
 * - Forward: {@link forwardSync} decides whether fleetd merges the default
 *   branch into the state ref on this tick.
 * - Back: {@link syncPrDecision} decides whether a sync pull request from the
 *   state branch to the default branch opens, refreshes or stays absent, and
 *   {@link syncPathVerdict} decides whether a sync pull request's diff may be
 *   merged or reviewed.
 *
 * A reading that failed is `'unknown'`, never an answer: no decision here
 * reads an unknown as "nothing to sync" or "no pull request".
 *
 * @concept state-sync
 */
import type { StateWriteTarget } from './write-target.js';

/** The directories Plot writes, from the config keys that name them. */
export interface SyncPathKeys {
  /** The `Plan directory` value. */
  readonly planDir: string;
  /** The `Active index` value. */
  readonly activeIndex: string;
  /** The `Delivered index` value. */
  readonly deliveredIndex: string;
  /** The `Sprint directory` value. */
  readonly sprintDir: string;
  /** The directory `/plot-release` writes its checklist records under. */
  readonly releaseDir: string;
}

/** The release records' directory when a repository names none. */
export const DEFAULT_RELEASE_DIR = 'docs/releases/';

const asDir = (value: string): string => {
  const trimmed = value.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `${trimmed}/`;
};

/**
 * Enumerates the directories a sync pull request may change.
 *
 * @param keys - the config values.
 * @returns each non-empty directory once, with a trailing slash, in key order.
 */
export const syncPathSet = (keys: SyncPathKeys): readonly string[] => {
  const dirs = [keys.planDir, keys.activeIndex, keys.deliveredIndex, keys.sprintDir, keys.releaseDir].map(asDir);
  return [...new Set(dirs.filter((dir) => dir !== ''))];
};

/** The answer of the path gate. */
export type SyncPathVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: 'sync-path-outside-set' | 'sync-diff-unread'; readonly paths: readonly string[] };

const normalized = (path: string): string => path.replace(/^\.\//, '');

/**
 * Judges a sync pull request's changed paths against the set Plot writes.
 *
 * The judgement reads the paths of the diff and nothing else: not the title,
 * not the head branch's name. A path counts as inside when it lies beneath one
 * of the directories; a path with `..` segments never does.
 *
 * @param files - the paths the pull request changes; `'unknown'` where the diff could not be read.
 * @param set - the directories from {@link syncPathSet}.
 * @returns ok, or the refusal naming every path outside the set. An unread
 *   diff refuses as `sync-diff-unread`: absent is not clean.
 */
export const syncPathVerdict = (files: readonly string[] | 'unknown', set: readonly string[]): SyncPathVerdict => {
  if (files === 'unknown') return { ok: false, refusal: 'sync-diff-unread', paths: [] };
  const outside = files.map(normalized).filter((file) => file.split('/').includes('..') || !set.some((dir) => file.startsWith(dir)));
  return outside.length === 0 ? { ok: true } : { ok: false, refusal: 'sync-path-outside-set', paths: outside };
};

/** The two ends of a pull request that decide whether it is a sync pull request. */
export interface SyncPrShape {
  readonly head: string;
  readonly base: string;
}

/**
 * Whether a pull request carries the state branch to the default branch.
 *
 * @param pr - the pull request's head and base branch names.
 * @param target - the resolved state target.
 * @param defaultBranch - the default branch's short name.
 * @returns true for a pull request from the state branch to the default branch.
 *   A non-branch state ref never has one.
 */
export const isSyncPr = (pr: SyncPrShape, target: StateWriteTarget, defaultBranch: string): boolean =>
  target.isBranch && `refs/heads/${pr.head}` === target.pushRef && pr.base === defaultBranch;

/** A forward-merge conflict a tick met, keyed by the two tips it merged. */
export interface ForwardRefusal {
  readonly defaultTip: string;
  readonly stateTip: string;
  readonly files: readonly string[];
}

/** What fleetd read before it decides on a forward merge. */
export interface ForwardSyncReading {
  /** Commits `origin/<default>` holds that the state ref lacks; null where the count could not be read. */
  readonly behind: number | null;
  /** The default branch's tip; `'unknown'` where it could not be read. */
  readonly defaultTip: string;
  /** The state ref's tip; `'unknown'` where it could not be read. */
  readonly stateTip: string;
  /** Whether a writer holds the push lock; `'unknown'` where the lock could not be read. */
  readonly lockHeld: boolean | 'unknown';
  /** The conflict an earlier tick met, if any. */
  readonly refused: ForwardRefusal | null;
}

/** What a forward sync tick does. */
export type ForwardSyncDecision =
  | { readonly kind: 'idle'; readonly reason: 'in-sync' | 'unread' }
  | { readonly kind: 'wait'; readonly reason: 'writer-holds-lock' }
  | { readonly kind: 'refused'; readonly files: readonly string[] }
  | { readonly kind: 'merge' };

/**
 * Decides whether this tick merges the default branch into the state ref.
 *
 * A merge runs only where the default branch holds commits the state ref
 * lacks and no writer holds the push lock. A conflict an earlier tick met
 * stands while both tips are the ones it met, so a tick never retries past it
 * and never picks a side; a moved tip is a new question and merges again.
 *
 * @param reading - the readings of this tick.
 * @returns `idle` where nothing is behind or a read failed, `wait` where a
 *   writer holds the lock or the lock could not be read, `refused` where the
 *   known conflict stands, else `merge`.
 */
export const forwardSync = (reading: ForwardSyncReading): ForwardSyncDecision => {
  if (reading.behind === null || reading.defaultTip === 'unknown' || reading.stateTip === 'unknown') {
    return { kind: 'idle', reason: 'unread' };
  }
  if (reading.behind === 0) return { kind: 'idle', reason: 'in-sync' };
  const known = reading.refused;
  if (known !== null && known.defaultTip === reading.defaultTip && known.stateTip === reading.stateTip) {
    return { kind: 'refused', files: known.files };
  }
  if (reading.lockHeld !== false) return { kind: 'wait', reason: 'writer-holds-lock' };
  return { kind: 'merge' };
};

/** Who asks for the sync pull request. */
export type SyncCaller = 'fleetd' | 'command';

/** What the sync pull request's decision reads. */
export interface SyncPrReading {
  /** Who asks. */
  readonly caller: SyncCaller;
  /** The resolved state target. */
  readonly target: StateWriteTarget;
  /** Whether a plan reached Delivered on the state ref that the default branch does not hold as Delivered; `'unknown'` where it could not be read. */
  readonly deliveredPending: boolean | 'unknown';
  /** Commits the state ref holds that the default branch lacks; null where unread. */
  readonly ahead: number | null;
  /**
   * The open sync pull request's number the host named; null where the host
   * was asked and holds none; `'unknown'` where the ask failed.
   */
  readonly open: number | null | 'unknown';
  /** Whether a fleet heartbeat is live; `'unknown'` where it could not be read. Read only for the command caller. */
  readonly fleetLive: boolean | 'unknown';
  /** The last refresh this machine posted; null where none is recorded or the record could not be read. */
  readonly refreshed: SyncPrRefresh | null;
}

/** One refresh of a sync pull request: the pull request and the count its comment stated. */
export interface SyncPrRefresh {
  readonly pr: number;
  readonly ahead: number;
}

/** What the sync pull request's decision answers. */
export type SyncPrDecision =
  | { readonly kind: 'none'; readonly reason: 'no-branch' | 'not-delivered' | 'nothing-ahead' | 'fleet-owns-it' | 'unchanged' }
  | { readonly kind: 'unknown'; readonly reason: 'delivered-unread' | 'ahead-unread' | 'open-unread' | 'fleet-unread' }
  | { readonly kind: 'open' }
  | { readonly kind: 'refresh'; readonly pr: number };

/**
 * Decides whether a sync pull request opens, refreshes or stays absent.
 *
 * The moment is Delivered (D13): a plan that reached Delivered on the state
 * ref makes the pull request open, or refreshes the open one. A state ref that
 * is not a branch gets none. Where a sync pull request is open, the decision
 * is never a second `open`: it is `refresh` where the count ahead differs from
 * the last refresh recorded for that pull request, and `none` (`unchanged`)
 * where it equals it, so a 60 s tick posts nothing between changes. The command
 * caller yields to a live fleet, so fleetd stays the one opener; where it
 * cannot tell, it does not act.
 *
 * @param reading - the readings.
 * @returns the decision; an unread input is `unknown`, never `none`.
 */
export const syncPrDecision = (reading: SyncPrReading): SyncPrDecision => {
  if (!reading.target.isBranch) return { kind: 'none', reason: 'no-branch' };
  if (reading.caller === 'command') {
    if (reading.fleetLive === 'unknown') return { kind: 'unknown', reason: 'fleet-unread' };
    if (reading.fleetLive) return { kind: 'none', reason: 'fleet-owns-it' };
  }
  if (reading.open === 'unknown') return { kind: 'unknown', reason: 'open-unread' };
  if (reading.open !== null) {
    if (reading.ahead === null) return { kind: 'unknown', reason: 'ahead-unread' };
    const said = reading.refreshed;
    if (said !== null && said.pr === reading.open && said.ahead === reading.ahead) return { kind: 'none', reason: 'unchanged' };
    return { kind: 'refresh', pr: reading.open };
  }
  if (reading.deliveredPending === 'unknown') return { kind: 'unknown', reason: 'delivered-unread' };
  if (!reading.deliveredPending) return { kind: 'none', reason: 'not-delivered' };
  if (reading.ahead === null) return { kind: 'unknown', reason: 'ahead-unread' };
  if (reading.ahead === 0) return { kind: 'none', reason: 'nothing-ahead' };
  return { kind: 'open' };
};

/**
 * Whether the sync is complete, from the host's answer and the trees.
 *
 * Never ancestry: a squash-merge rewrites the state tip's commits, so the tip
 * is not an ancestor of the default branch after every sync.
 *
 * @param mergedAt - the sync pull request's `mergedAt`; null where unmerged.
 * @param stateTree - the state tip's tree id.
 * @param defaultTree - the default tip's tree id.
 * @returns true where the trees are equal. A merged pull request with unequal
 *   trees reads false: the state ref moved after the merge.
 */
export const syncedByTrees = (mergedAt: string | null, stateTree: string, defaultTree: string): boolean =>
  stateTree !== '' && stateTree === defaultTree && (mergedAt === null || mergedAt !== '');

/** The title of a sync pull request. */
export const syncPrTitle = (stateBranch: string, defaultBranch: string): string =>
  `plot: sync records from ${stateBranch} to ${defaultBranch}`;

/** The marker a refresh comment carries, so a repeat replaces rather than appends. */
export const SYNC_PR_MARKER = 'plot-state-sync';

/**
 * The body a sync pull request opens with and a refresh restates.
 *
 * @param ahead - commits the state ref holds that the default branch lacks.
 * @param stateBranch - the state branch's short name.
 * @param defaultBranch - the default branch's short name.
 * @returns the text; its first line is an HTML comment carrying {@link SYNC_PR_MARKER}, which the host's
 *   marker lookup finds, so a refresh edits the comment it posted before. It names the squash and the merge rule,
 *   never a bypass.
 */
export const syncPrBody = (ahead: number, stateBranch: string, defaultBranch: string): string =>
  [
    `<!-- ${SYNC_PR_MARKER} -->`,
    `${ahead} record commit${ahead === 1 ? '' : 's'} on \`${stateBranch}\` that \`${defaultBranch}\` lacks.`,
    '',
    `Squash-merge this pull request: one commit lands on \`${defaultBranch}\`, and \`${stateBranch}\` keeps its history.`,
    'It changes only files Plot writes. The host\'s merge rule decides who merges it.',
  ].join('\n');
