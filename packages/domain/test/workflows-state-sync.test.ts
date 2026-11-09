import { describe, it, expect } from 'vitest';
import { writeTarget, type StateWriteTarget } from '../src/rules/write-target.js';
import { answered, failed, type PortResult } from '../src/port-result.js';
import {
  commitsBetween,
  deliveredPending,
  fleetLiveAt,
  forwardSyncAt,
  openSyncPr,
  syncPrAt,
  type StateSyncPorts,
  type StateSyncSource,
} from '../src/workflows/state-sync.js';

const stateTarget = (key: string): StateWriteTarget => {
  const t = writeTarget(key, 'main');
  if (t.kind !== 'state') throw new Error('expected state');
  return t;
};

const plan = (state: string): string => `# P\n\n## Status\n\nState: ${state}\n`;
const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ sha: `c${i}`, subject: `s${i}` }));

interface World {
  prs?: readonly { number: number; head: string; base: string; state: string }[] | 'fail';
  changed?: readonly string[] | 'fail';
  files?: Readonly<Record<string, string>>;
  ahead?: number | 'fail';
  behind?: number | 'fail';
  created?: string[];
  comments?: { pr: number; marker?: string; body?: string }[];
  refreshed?: { pr: number; ahead: number } | null;
  fail?: readonly ('comment' | 'create' | 'exists' | 'resolve' | 'base')[];
}

const portsOf = (world: World): StateSyncPorts => {
  const target = stateTarget('plot/state');
  const files = world.files ?? {};
  return {
    host: {
      prList: async () => (world.prs === 'fail' ? failed() : answered((world.prs ?? []) as never)),
      prCreate: async (req) => {
        world.created?.push(req.head);
        if (world.fail?.includes('create')) return failed();
        return answered('https://host/pr/9');
      },
      prComment: async (pr, body, marker) => {
        world.comments?.push({ pr, marker, body });
        if (world.fail?.includes('comment')) return failed();
        return answered(undefined as never);
      },
    },
    record: {
      refreshed: async () => answered(world.refreshed ?? null),
      noteRefresh: async (refresh) => {
        world.refreshed = refresh;
        return answered(undefined);
      },
    },
    refs: {
      commitSubjects: async (range: string) => {
        const n = range === `${target.defaultRef}..${target.trackRef}` ? world.ahead : world.behind;
        return n === 'fail' ? failed() : answered(lines(n ?? 0) as never);
      },
      changedFiles: async () => (world.changed === 'fail' ? failed() : answered([...(world.changed ?? [])])),
      showFile: async (ref: string, path: string) => {
        const text = files[`${ref}:${path}`];
        if (world.fail?.includes('base') && ref === target.defaultRef) return failed();
        return text === undefined ? failed() : answered(text);
      },
      fileExistsSync: (ref: string, path: string) => (world.fail?.includes('exists') ? failed() : answered(files[`${ref}:${path}`] !== undefined)),
      resolve: async (ref: string) => (world.fail?.includes('resolve') ? failed() : answered(ref === target.defaultRef ? 'd1' : 's1')),
    },
  };
};

const source = (key = 'plot/state'): StateSyncSource => ({ target: stateTarget(key), defaultBranch: 'main', planDir: 'docs/plans/' });
const P = 'docs/plans/2026-11-07-x.md';
const delivered = (): World => ({
  changed: [P],
  ahead: 3,
  files: { [`refs/remotes/origin/plot/state:${P}`]: plan('Delivered'), [`refs/remotes/origin/main:${P}`]: plan('Approved') },
});

describe('syncPrAt', () => {
  it('opens one sync PR when a plan reached Delivered on the state ref', async () => {
    const world = { ...delivered(), created: [] as string[] };
    const done = await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown');
    expect(done).toEqual({ done: 'opened', url: 'https://host/pr/9' });
    expect(world.created).toEqual(['plot/state']);
  });

  it('refreshes the open sync PR and opens none', async () => {
    const world: World = { ...delivered(), created: [], comments: [], prs: [{ number: 7, head: 'plot/state', base: 'main', state: 'OPEN' }] };
    const done = await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown');
    expect(done).toEqual({ done: 'refreshed', pr: 7 });
    expect(world.created).toEqual([]);
    expect(world.comments).toMatchObject([{ pr: 7, marker: 'plot-state-sync' }]);
    expect(world.comments?.[0]?.body).toContain('plot-state-sync');
    expect(world.refreshed).toEqual({ pr: 7, ahead: 3 });
  });

  it('posts nothing on a later tick until the count ahead changes', async () => {
    const world: World = { ...delivered(), comments: [], prs: [{ number: 7, head: 'plot/state', base: 'main', state: 'OPEN' }] };
    await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown');
    expect(await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown')).toEqual({ done: 'none', reason: 'unchanged' });
    expect(world.comments).toHaveLength(1);
    world.ahead = 4;
    expect(await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown')).toEqual({ done: 'refreshed', pr: 7 });
    expect(world.comments).toHaveLength(2);
  });

  it('reads a failed PR list as unknown and opens nothing', async () => {
    const world = { ...delivered(), created: [] as string[], prs: 'fail' as const };
    expect(await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown')).toEqual({ done: 'unknown', reason: 'open-unread' });
    expect(world.created).toEqual([]);
  });

  it('yields to a live fleet for the command caller and acts with none', async () => {
    const live = { ...delivered(), created: [] as string[] };
    expect(await syncPrAt(portsOf(live), source(), 'command', true)).toEqual({ done: 'none', reason: 'fleet-owns-it' });
    expect(live.created).toEqual([]);
    const idle = { ...delivered(), created: [] as string[] };
    expect((await syncPrAt(portsOf(idle), source(), 'command', false)).done).toBe('opened');
    expect(idle.created).toEqual(['plot/state']);
  });

  it('opens nothing for a non-branch state ref', async () => {
    const world = { ...delivered(), created: [] as string[] };
    expect(await syncPrAt(portsOf(world), source('refs/plot/state'), 'fleetd', 'unknown')).toEqual({ done: 'none', reason: 'no-branch' });
    expect(world.created).toEqual([]);
  });

  it('opens nothing when no plan reached Delivered', async () => {
    const world = { ...delivered(), created: [] as string[], files: { [`refs/remotes/origin/plot/state:${P}`]: plan('Approved'), [`refs/remotes/origin/main:${P}`]: plan('Approved') } };
    expect(await syncPrAt(portsOf(world), source(), 'fleetd', 'unknown')).toEqual({ done: 'none', reason: 'not-delivered' });
  });
});

describe('a host that refuses', () => {
  it('reports a refused refresh comment and a refused create as failed', async () => {
    const open = { ...delivered(), fail: ['comment' as const], prs: [{ number: 7, head: 'plot/state', base: 'main', state: 'OPEN' }] };
    expect(await syncPrAt(portsOf(open), source(), 'fleetd', 'unknown')).toEqual({ done: 'failed', why: 'the host did not take the refresh comment on PR #7' });
    const none = { ...delivered(), fail: ['create' as const] };
    expect(await syncPrAt(portsOf(none), source(), 'fleetd', 'unknown')).toEqual({ done: 'failed', why: 'the host did not open the sync pull request' });
  });
});

describe('the readings', () => {
  it('reads a failed existence check or base file as unknown', async () => {
    expect(await deliveredPending(portsOf({ ...delivered(), fail: ['exists'] }).refs, source())).toBe('unknown');
    const files = { [`refs/remotes/origin/plot/state:${P}`]: plan('Delivered'), [`refs/remotes/origin/main:${P}`]: plan('Approved') };
    expect(await deliveredPending(portsOf({ changed: [P], files, fail: ['base'] }).refs, source())).toBe('unknown');
  });

  it('treats a plan Delivered on both refs as settled and a Released base as booked', async () => {
    const files = { [`refs/remotes/origin/plot/state:${P}`]: plan('Delivered'), [`refs/remotes/origin/main:${P}`]: plan('Released') };
    expect(await deliveredPending(portsOf({ changed: [P], files }).refs, source())).toBe(false);
  });

  it('counts a new plan file absent from the default branch as pending', async () => {
    const files = { [`refs/remotes/origin/plot/state:${P}`]: plan('Delivered') };
    expect(await deliveredPending(portsOf({ changed: [P], files }).refs, source())).toBe(true);
  });

  it('reads a failed diff or file as unknown', async () => {
    expect(await deliveredPending(portsOf({ changed: 'fail' }).refs, source())).toBe('unknown');
    expect(await deliveredPending(portsOf({ changed: [P], files: {} }).refs, source())).toBe('unknown');
  });

  it('ignores files below the plan directory and non-markdown files', async () => {
    expect(await deliveredPending(portsOf({ changed: ['docs/plans/active/x.md', 'docs/plans/a.txt'] }).refs, source())).toBe(false);
  });

  it('counts commits and reads a failure as null', async () => {
    expect(await commitsBetween(portsOf({ behind: 4 }).refs, 'a', 'b')).toBe(4);
    expect(await commitsBetween(portsOf({ behind: 'fail' }).refs, 'a', 'b')).toBeNull();
  });

  it('names an open sync PR by its ends and not its title', async () => {
    const prs = [
      { number: 1, head: 'other', base: 'main', state: 'OPEN' },
      { number: 2, head: 'plot/state', base: 'develop', state: 'OPEN' },
      { number: 3, head: 'plot/state', base: 'main', state: 'OPEN' },
    ];
    expect(await openSyncPr(portsOf({ prs }).host, source())).toBe(3);
    expect(await openSyncPr(portsOf({ prs: [] }).host, source())).toBeNull();
    expect(await openSyncPr(portsOf({ prs: 'fail' }).host, source())).toBe('unknown');
  });
});

describe('forwardSyncAt', () => {
  const t = stateTarget('plot/state');
  it('merges a state ref behind the default branch when no writer holds the lock', async () => {
    const r = await forwardSyncAt(portsOf({ behind: 2 }).refs, t, { lockHeld: false, refused: null });
    expect(r.decision).toEqual({ kind: 'merge' });
    expect([r.defaultTip, r.stateTip]).toEqual(['d1', 's1']);
  });

  it('waits where the lock is held', async () => {
    expect((await forwardSyncAt(portsOf({ behind: 2 }).refs, t, { lockHeld: true, refused: null })).decision.kind).toBe('wait');
  });

  it('stands on a known conflict while both tips are unchanged', async () => {
    const refused = { defaultTip: 'd1', stateTip: 's1', files: ['docs/plans/x.md'] };
    expect((await forwardSyncAt(portsOf({ behind: 2 }).refs, t, { lockHeld: false, refused })).decision).toEqual({ kind: 'refused', files: ['docs/plans/x.md'] });
  });

  it('is idle where a tip could not be resolved', async () => {
    const r = await forwardSyncAt(portsOf({ behind: 2, fail: ['resolve'] }).refs, t, { lockHeld: false, refused: null });
    expect(r).toEqual({ decision: { kind: 'idle', reason: 'unread' }, defaultTip: 'unknown', stateTip: 'unknown' });
  });

  it('is idle where nothing is behind or the count is unread', async () => {
    expect((await forwardSyncAt(portsOf({ behind: 0 }).refs, t, { lockHeld: false, refused: null })).decision.kind).toBe('idle');
    expect((await forwardSyncAt(portsOf({ behind: 'fail' }).refs, t, { lockHeld: false, refused: null })).decision.kind).toBe('idle');
  });
});

describe('fleetLiveAt', () => {
  const lockOf = (beats: readonly { name: string; at: number }[] | 'fail') => ({
    heartbeats: async (): Promise<PortResult<readonly { name: string; at: number }[]>> =>
      beats === 'fail' ? failed<readonly { name: string; at: number }[]>() : answered(beats),
  });
  it('is live for a fresh fleetd heartbeat only', async () => {
    const now = 1_000_000;
    expect(await fleetLiveAt(lockOf([{ name: 'fleetd', at: now - 1000 }]), 'github', now)).toBe(true);
    expect(await fleetLiveAt(lockOf([{ name: 'fleetd', at: 0 }]), 'github', now)).toBe(false);
    expect(await fleetLiveAt(lockOf([{ name: 'reader.12', at: now }]), 'github', now)).toBe(false);
    expect(await fleetLiveAt(lockOf([]), 'github', now)).toBe(false);
  });
  it('reads a failed ask as unknown', async () => {
    expect(await fleetLiveAt(lockOf('fail'), 'github', 1)).toBe('unknown');
  });
});
