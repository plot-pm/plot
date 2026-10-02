import { describe, expect, it } from 'vitest';

import {
  deskProcessState,
  deskWorker,
  type DeskWorkerReading,
  type ManifestWorkerReading,
} from '../src/rules/desk-worker.js';

const OLD = '/estate/.worktrees/free-9cbeda11';
const NEW = '/estate/.worktrees/plot-wt-bug-next';

const manifest = (over: Partial<ManifestWorkerReading> = {}): ManifestWorkerReading => ({
  worktree: NEW,
  pid: '60290',
  ...over,
});

const reading = (over: Partial<DeskWorkerReading> = {}): DeskWorkerReading => ({
  desk: OLD,
  deskReal: OLD,
  deskPid: '60290',
  manifests: [manifest()],
  ...over,
});

describe('deskWorker', () => {
  it('answers left when a manifest places the desk pid at another desk', () => {
    expect(deskWorker(reading())).toEqual({ kind: 'left', worktree: NEW });
  });

  it('answers here at the desk the manifest names', () => {
    expect(deskWorker(reading({ desk: NEW, deskReal: NEW }))).toEqual({ kind: 'here' });
  });

  it('answers here when no manifest records the desk pid — a free loop with no manifest', () => {
    expect(deskWorker(reading({ manifests: [manifest({ pid: '111' })] }))).toEqual({ kind: 'here' });
    expect(deskWorker(reading({ manifests: [] }))).toEqual({ kind: 'here' });
  });

  it('answers here when the desk has no pid record', () => {
    expect(deskWorker(reading({ deskPid: '' }))).toEqual({ kind: 'here' });
  });

  it('answers here when a manifest naming this desk records the same pid, whatever another manifest says', () => {
    const manifests = [manifest(), manifest({ worktree: OLD })];
    expect(deskWorker(reading({ manifests }))).toEqual({ kind: 'here' });
  });

  it('matches the desk by either path form on either side', () => {
    const link = '/link/free-9cbeda11';
    expect(deskWorker(reading({ desk: link, deskReal: OLD, manifests: [manifest({ worktree: OLD })] })))
      .toEqual({ kind: 'here' });
    expect(deskWorker(reading({ manifests: [manifest({ worktree: link, worktreeReal: OLD })] })))
      .toEqual({ kind: 'here' });
  });

  it('ignores a manifest that names no desk', () => {
    expect(deskWorker(reading({ manifests: [manifest({ worktree: '', worktreeReal: NEW })] })))
      .toEqual({ kind: 'here' });
  });

  it('names the first manifest that places the worker elsewhere', () => {
    const manifests = [manifest(), manifest({ worktree: '/estate/.worktrees/third' })];
    expect(deskWorker(reading({ manifests }))).toEqual({ kind: 'left', worktree: NEW });
  });

  it('matches an empty desk path against nothing', () => {
    expect(deskWorker(reading({ desk: '', deskReal: '' }))).toEqual({ kind: 'left', worktree: NEW });
  });
});

describe('deskProcessState', () => {
  it('reads a running desk whose worker left as ended', () => {
    expect(deskProcessState('running', { kind: 'left', worktree: NEW })).toBe('ended');
  });

  it('keeps running where the worker is here', () => {
    expect(deskProcessState('running', { kind: 'here' })).toBe('running');
  });

  it('leaves every other state unchanged', () => {
    for (const state of ['waiting', 'finished', 'stalled', 'failed', 'ended', 'none', 'elsewhere'] as const) {
      expect(deskProcessState(state, { kind: 'left', worktree: NEW })).toBe(state);
    }
  });
});
