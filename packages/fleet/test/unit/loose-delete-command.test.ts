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
  localRef: PortResult<string>;
  ahead: PortResult<number>;
  main: PortResult<string>;
  plan: { kind: 'none' } | { kind: 'unreadable' } | { kind: 'named'; file: string };
  manifests: PortResult<readonly string[]>;
  commits: PortResult<ReadonlyArray<{ subject: string; tree: string; parentTree: string | null }>>;
  pinOk: boolean;
}

const deletable = (): World => ({
  pr: ok(null),
  merged: ok('not-merged'),
  remote: ok({ sha: TIP }),
  local: ok(TIP),
  desk: ok(null),
  localRef: ok(''),
  ahead: ok(0),
  main: ok('main'),
  plan: { kind: 'none' },
  manifests: ok([]),
  commits: ok([{ subject: 'real work', tree: 't2', parentTree: 't1' }]),
  pinOk: true,
});

const run = async (over: Partial<World> & { branch?: string }, caller: 'person' | 'unattended' = 'person') => {
  const world = { ...deletable(), ...over };
  const calls: string[] = [];
  const ranges: string[] = [];
  const ports = {
    host: { prState: async () => world.pr, prMerged: async () => world.merged },
    refs: {
      resolve: async (ref: string) => (ref.startsWith('refs/heads/') ? world.localRef : world.local),
      remoteSha: async () => world.remote,
      defaultBranch: async () => world.main,
      commitSubjects: async (range: string) => {
        ranges.push(range);
        return world.commits;
      },
      countAheadSync: () => world.ahead,
    },
    plan: async () => world.plan,
    manifests: async () => world.manifests,
    trees: {
      forBranch: async () => world.desk,
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
  const outcome = await deleteLooseBranch({ repoRoot: '/r', scriptsDir: '/s', branch: world.branch ?? 'feature/x', caller, ports });
  return { outcome, calls, ranges };
};

describe('deleteLooseBranch', () => {
  it('pins the tip and then deletes the remote ref, in that order', async () => {
    const { outcome, calls } = await run({});
    expect(outcome).toEqual({ kind: 'deleted', branch: 'feature/x', tip: TIP, pin: `refs/plot/reaped/feature/x/${TIP}` });
    expect(calls).toEqual([`pin feature/x ${TIP}`, `delete feature/x ${TIP}`]);
  });

  const refusals: Array<[string, Partial<World> & { branch?: string }, string, 'person' | 'unattended']> = [
    ['the default branch', { branch: 'main' }, 'protected', 'person'],
    ['a sprint integration branch', { branch: 'sprint/ship-2-32-0' }, 'protected', 'person'],
    ['the Changesets release branch', { branch: 'changeset-release/main' }, 'protected', 'person'],
    ['an open PR', { pr: ok({ number: 7, state: 'OPEN' }) }, 'open-pr', 'person'],
    ['an unpushed commit on the local branch', { localRef: ok('c'.repeat(40)), ahead: ok(1) }, 'unpushed', 'person'],
    ['a local branch whose lead cannot be counted', { localRef: ok('c'.repeat(40)), ahead: silent() }, 'unaskable', 'person'],
    ['a branch a plan names', { plan: { kind: 'named', file: 'docs/plans/p.md' } }, 'named', 'person'],
    ['plans that cannot be read', { plan: { kind: 'unreadable' } }, 'unaskable', 'person'],
    ['a desk on this machine', { desk: ok({ path: '/w' }) }, 'held', 'person'],
    ['a registry manifest', { manifests: ok(['agent-3']) }, 'held', 'person'],
    ['a registry that cannot be read', { manifests: silent() }, 'unaskable', 'person'],
    ['a claim marker', { commits: ok([{ subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' }]) }, 'claimed', 'person'],
    ['commits that cannot be listed', { commits: silent() }, 'unaskable', 'person'],
    ['a default branch that cannot be read', { main: silent() }, 'unaskable', 'person'],
    ['a host that cannot say about the PR', { pr: silent() }, 'unaskable', 'person'],
    ['a host that cannot say about the merge', { merged: silent() }, 'unaskable', 'person'],
    ['a merge answer of unknown', { merged: ok('unknown') }, 'unaskable', 'person'],
    ['a merged PR', { merged: ok('merged') }, 'merged', 'person'],
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

  it('a local branch with no unpushed commit does not refuse', async () => {
    const { outcome } = await run({ localRef: ok('c'.repeat(40)), ahead: ok(0) });
    expect(outcome.kind).toBe('deleted');
  });

  it('reads the claim marker over the default branch to the branch on origin', async () => {
    const { ranges } = await run({});
    expect(ranges).toEqual(['origin/main..origin/feature/x']);
  });
});
