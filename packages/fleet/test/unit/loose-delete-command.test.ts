import { describe, expect, it } from 'vitest';
import type { PortResult } from '@plot-pm/domain';
import { deleteLooseBranch, type LooseDeletePorts } from '../../src/shared/loose-delete-command.js';

const TIP = 'a'.repeat(40);
const ok = <T>(value: T): PortResult<T> => ({ ok: true, value });
const silent = <T>(): PortResult<T> => ({ ok: false, why: 'unaskable' });

/** Readings that make a delete go through; each test changes exactly one. */
interface World {
  pr: PortResult<{ number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' } | null>;
  merged: PortResult<'merged' | 'not-merged' | 'unknown'>;
  remote: PortResult<{ sha: string } | 'unknown'>;
  local: PortResult<string>;
  desk: PortResult<{ path: string } | null>;
  unpushed: PortResult<readonly string[]>;
  pinOk: boolean;
}

const deletable = (): World => ({
  pr: ok(null),
  merged: ok('not-merged'),
  remote: ok({ sha: TIP }),
  local: ok(TIP),
  desk: ok(null),
  unpushed: ok([]),
  pinOk: true,
});

const run = async (over: Partial<World>, caller: 'person' | 'unattended' = 'person') => {
  const world = { ...deletable(), ...over };
  const calls: string[] = [];
  const ports = {
    host: { prState: async () => world.pr, prMerged: async () => world.merged },
    refs: { resolve: async () => world.local, remoteSha: async () => world.remote },
    trees: {
      forBranch: async () => world.desk,
      unpushedCommits: async () => world.unpushed,
      deleteRemoteBranch: async (branch: string, tip: string) => {
        calls.push(`delete ${branch} ${tip}`);
        return ok(undefined);
      },
    },
    pinnedTips: {
      pin: async (branch: string, sha: string) => {
        calls.push(`pin ${branch} ${sha}`);
        return world.pinOk ? ok(`refs/plot/reaped/${branch}/${sha}`) : ({ ok: false, why: 'failed' } as const);
      },
      prune: async () => ok([]),
    },
  } as unknown as LooseDeletePorts;
  const outcome = await deleteLooseBranch({ repoRoot: '/r', scriptsDir: '/s', branch: 'feature/x', caller, ports });
  return { outcome, calls };
};

describe('deleteLooseBranch', () => {
  it('pins the tip and then deletes the remote ref, in that order', async () => {
    const { outcome, calls } = await run({});
    expect(outcome).toEqual({ kind: 'deleted', branch: 'feature/x', tip: TIP, pin: `refs/plot/reaped/feature/x/${TIP}` });
    expect(calls).toEqual([`pin feature/x ${TIP}`, `delete feature/x ${TIP}`]);
  });

  const refusals: Array<[string, Partial<World>, string, 'person' | 'unattended']> = [
    ['an open PR', { pr: ok({ number: 7, state: 'OPEN' }) }, 'open-pr', 'person'],
    ['an unpushed commit', { desk: ok({ path: '/w' }), unpushed: ok(['abc1234']) }, 'unpushed', 'person'],
    ['a host that cannot say about the PR', { pr: silent() }, 'unaskable', 'person'],
    ['a host that cannot say about the merge', { merged: silent() }, 'unaskable', 'person'],
    ['a merge answer of unknown', { merged: ok('unknown') }, 'unaskable', 'person'],
    ['a merged PR', { merged: ok('merged') }, 'merged', 'person'],
    ['a checkout whose unpushed commits cannot be read', { desk: ok({ path: '/w' }), unpushed: silent() }, 'unaskable', 'person'],
    ['a checkout lookup that failed', { desk: { ok: false, why: 'failed' } }, 'unaskable', 'person'],
    ['an unreadable remote ref', { remote: ok('unknown') }, 'no-remote-branch', 'person'],
    ['a remote tip this clone does not hold', { local: ok('b'.repeat(40)) }, 'tip-moved', 'person'],
    ['an unattended caller', {}, 'unattended', 'unattended'],
  ];
  for (const [name, over, reason, caller] of refusals) {
    it(`refuses ${name} and deletes nothing`, async () => {
      const { outcome, calls } = await run(over, caller);
      expect(outcome).toMatchObject({ kind: 'refused', reason });
      expect(calls).toEqual([]);
    });
  }

  it('keeps a CLOSED, unmerged PR deletable', async () => {
    const { outcome } = await run({ pr: ok({ number: 7, state: 'CLOSED' }) });
    expect(outcome.kind).toBe('deleted');
  });

  it('deletes nothing when the pin does not land', async () => {
    const { outcome, calls } = await run({ pinOk: false });
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'unpinned' });
    expect(calls).toEqual([`pin feature/x ${TIP}`]);
  });

  it('a checkout with no unpushed commit does not refuse', async () => {
    const { outcome } = await run({ desk: ok({ path: '/w' }), unpushed: ok([]) });
    expect(outcome.kind).toBe('deleted');
  });
});
