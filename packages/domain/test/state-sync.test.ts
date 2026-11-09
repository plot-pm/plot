import { describe, it, expect } from 'vitest';
import { writeTarget, type StateWriteTarget } from '../src/rules/write-target.js';
import {
  forwardSync,
  isSyncPr,
  syncPathSet,
  syncPathVerdict,
  SYNC_PR_MARKER,
  syncPrBody,
  syncPrDecision,
  syncedByTrees,
  type ForwardSyncReading,
  type SyncPrReading,
} from '../src/rules/state-sync.js';

const target = (key: string): StateWriteTarget => {
  const t = writeTarget(key, 'main');
  if (t.kind !== 'state') throw new Error('expected state');
  return t;
};

const set = syncPathSet({
  planDir: 'docs/plans/',
  activeIndex: 'docs/plans/active/',
  deliveredIndex: 'docs/plans/delivered',
  sprintDir: './docs/sprints/',
  releaseDir: 'docs/releases/',
});

describe('syncPathVerdict', () => {
  it('enumerates each directory once, with a trailing slash', () => {
    expect(set).toEqual(['docs/plans/', 'docs/plans/active/', 'docs/plans/delivered/', 'docs/sprints/', 'docs/releases/']);
  });

  it('drops a directory key that is empty', () => {
    expect(syncPathSet({ planDir: 'docs/plans', activeIndex: '', deliveredIndex: ' ', sprintDir: './', releaseDir: 'r/' })).toEqual(['docs/plans/', 'r/']);
  });

  it('passes a diff inside the set', () => {
    expect(syncPathVerdict(['docs/plans/2026-11-07-x.md', 'docs/plans/active/x.md', 'docs/releases/vnext-checklist.md'], set)).toEqual({ ok: true });
  });

  it('refuses code and names every path outside the set', () => {
    expect(syncPathVerdict(['docs/plans/x.md', 'packages/domain/a.ts', 'README.md'], set)).toEqual({
      ok: false,
      refusal: 'sync-path-outside-set',
      paths: ['packages/domain/a.ts', 'README.md'],
    });
  });

  it('refuses a path that climbs out of the set', () => {
    expect(syncPathVerdict(['docs/plans/../../x.sh'], set).ok).toBe(false);
  });

  it('refuses a directory name that only shares a prefix', () => {
    expect(syncPathVerdict(['docs/plans-old/x.md'], set).ok).toBe(false);
  });

  it('refuses an unread diff', () => {
    expect(syncPathVerdict('unknown', set)).toEqual({ ok: false, refusal: 'sync-diff-unread', paths: [] });
  });
});

describe('isSyncPr', () => {
  it('matches the state branch into the default branch', () => {
    expect(isSyncPr({ head: 'plot/state', base: 'main' }, target('plot/state'), 'main')).toBe(true);
    expect(isSyncPr({ head: 'plot/state', base: 'develop' }, target('plot/state'), 'main')).toBe(false);
    expect(isSyncPr({ head: 'feature/x', base: 'main' }, target('plot/state'), 'main')).toBe(false);
  });
  it('never matches for a non-branch ref', () => {
    expect(isSyncPr({ head: 'plot/state', base: 'main' }, target('refs/plot/state'), 'main')).toBe(false);
  });
});

const fwd = (over: Partial<ForwardSyncReading> = {}): ForwardSyncReading => ({
  behind: 2,
  defaultTip: 'd1',
  stateTip: 's1',
  lockHeld: false,
  refused: null,
  ...over,
});

describe('forwardSync', () => {
  it('merges where the default branch is ahead and no writer holds the lock', () => {
    expect(forwardSync(fwd())).toEqual({ kind: 'merge' });
  });
  it('is idle where nothing is behind', () => {
    expect(forwardSync(fwd({ behind: 0 }))).toEqual({ kind: 'idle', reason: 'in-sync' });
  });
  it('waits where a writer holds the lock, and where the lock is unread', () => {
    expect(forwardSync(fwd({ lockHeld: true }))).toEqual({ kind: 'wait', reason: 'writer-holds-lock' });
    expect(forwardSync(fwd({ lockHeld: 'unknown' }))).toEqual({ kind: 'wait', reason: 'writer-holds-lock' });
  });
  it('reads a failed count or tip as unread, never as in sync', () => {
    expect(forwardSync(fwd({ behind: null }))).toEqual({ kind: 'idle', reason: 'unread' });
    expect(forwardSync(fwd({ defaultTip: 'unknown' }))).toEqual({ kind: 'idle', reason: 'unread' });
    expect(forwardSync(fwd({ stateTip: 'unknown' }))).toEqual({ kind: 'idle', reason: 'unread' });
  });
  it('holds a known conflict while both tips are unchanged, and retries when one moved', () => {
    const refused = { defaultTip: 'd1', stateTip: 's1', files: ['docs/plans/x.md'] };
    expect(forwardSync(fwd({ refused }))).toEqual({ kind: 'refused', files: ['docs/plans/x.md'] });
    expect(forwardSync(fwd({ refused, defaultTip: 'd2' }))).toEqual({ kind: 'merge' });
    expect(forwardSync(fwd({ refused, stateTip: 's2' }))).toEqual({ kind: 'merge' });
  });
  it('reports a known conflict even while a writer holds the lock', () => {
    const refused = { defaultTip: 'd1', stateTip: 's1', files: ['a.md'] };
    expect(forwardSync(fwd({ refused, lockHeld: true })).kind).toBe('refused');
  });
});

const pr = (over: Partial<SyncPrReading> = {}): SyncPrReading => ({
  caller: 'fleetd',
  target: target('plot/state'),
  deliveredPending: true,
  ahead: 3,
  open: null,
  fleetLive: false,
  refreshed: null,
  ...over,
});

describe('syncPrDecision', () => {
  it('opens one pull request when a plan reached Delivered', () => {
    expect(syncPrDecision(pr())).toEqual({ kind: 'open' });
  });
  it('refreshes the open one and never opens a second', () => {
    expect(syncPrDecision(pr({ open: 41 }))).toEqual({ kind: 'refresh', pr: 41 });
    expect(syncPrDecision(pr({ open: 41, deliveredPending: false }))).toEqual({ kind: 'refresh', pr: 41 });
  });
  it('refreshes only where the count ahead differs from the last refresh of that pull request', () => {
    expect(syncPrDecision(pr({ open: 41, refreshed: { pr: 41, ahead: 3 } }))).toEqual({ kind: 'none', reason: 'unchanged' });
    expect(syncPrDecision(pr({ open: 41, refreshed: { pr: 41, ahead: 2 } }))).toEqual({ kind: 'refresh', pr: 41 });
    expect(syncPrDecision(pr({ open: 41, refreshed: { pr: 40, ahead: 3 } }))).toEqual({ kind: 'refresh', pr: 41 });
    expect(syncPrDecision(pr({ open: 41, ahead: null }))).toEqual({ kind: 'unknown', reason: 'ahead-unread' });
  });
  it('opens nothing before a plan is delivered', () => {
    expect(syncPrDecision(pr({ deliveredPending: false }))).toEqual({ kind: 'none', reason: 'not-delivered' });
  });
  it('opens nothing for a non-branch ref', () => {
    expect(syncPrDecision(pr({ target: target('refs/plot/state') }))).toEqual({ kind: 'none', reason: 'no-branch' });
  });
  it('reads a failed ask as unknown, never as no pull request', () => {
    expect(syncPrDecision(pr({ open: 'unknown' }))).toEqual({ kind: 'unknown', reason: 'open-unread' });
    expect(syncPrDecision(pr({ deliveredPending: 'unknown' }))).toEqual({ kind: 'unknown', reason: 'delivered-unread' });
    expect(syncPrDecision(pr({ ahead: null }))).toEqual({ kind: 'unknown', reason: 'ahead-unread' });
  });
  it('opens nothing where nothing is ahead', () => {
    expect(syncPrDecision(pr({ ahead: 0 }))).toEqual({ kind: 'none', reason: 'nothing-ahead' });
  });
  it('lets the command caller act only where no fleet heartbeat is live', () => {
    expect(syncPrDecision(pr({ caller: 'command' }))).toEqual({ kind: 'open' });
    expect(syncPrDecision(pr({ caller: 'command', fleetLive: true }))).toEqual({ kind: 'none', reason: 'fleet-owns-it' });
    expect(syncPrDecision(pr({ caller: 'command', fleetLive: 'unknown' }))).toEqual({ kind: 'unknown', reason: 'fleet-unread' });
  });
});

describe('syncedByTrees', () => {
  it('reads equal trees as synced, with no ancestry', () => {
    expect(syncedByTrees('2026-11-08T00:00:00Z', 't1', 't1')).toBe(true);
    expect(syncedByTrees('2026-11-08T00:00:00Z', 't2', 't1')).toBe(false);
    expect(syncedByTrees(null, '', '')).toBe(false);
  });
});

describe('syncPrBody', () => {
  it('names the squash and counts the commits', () => {
    expect(syncPrBody(1, 'plot/state', 'main')).toContain('1 record commit on');
    expect(syncPrBody(3, 'plot/state', 'main')).toContain('3 record commits');
  });
  it('carries the marker the host finds the comment by', () => {
    expect(syncPrBody(3, 'plot/state', 'main').split('\n')[0]).toBe(`<!-- ${SYNC_PR_MARKER} -->`);
  });
});
