import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PortResult } from '@plot-pm/domain';
import { hostShell } from '@plot-pm/domain/adapters';
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
  plan: { kind: 'none' } | { kind: 'unreadable' } | { kind: 'named'; file: string; phase: string };
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
    ['a branch a plan names', { plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'approved' } }, 'named', 'person'],
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

  describe('a claimed branch whose work ended in a closed, unmerged PR', () => {
    // The shape of feature/a-merged-pending-check-is-asked-again: a claim
    // marker, then two commits of work, and PR #1425 closed with no merge.
    const claimedWork = ok([
      { subject: 'plot-fleet: the budget test counts the merged re-ask too', tree: 't3', parentTree: 't2' },
      { subject: "plot-fleet: re-ask a merged PR's stored pending checks (#1418)", tree: 't2', parentTree: 't1' },
      { subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' },
    ]);
    const closed = ok({ number: 1425, state: 'CLOSED' as const });

    it('deletes it where the host answers not-merged', async () => {
      const { outcome, calls } = await run({ commits: claimedWork, pr: closed, merged: ok('not-merged') });
      expect(outcome.kind).toBe('deleted');
      expect(calls).toEqual([`pin feature/x ${TIP}`, `delete feature/x ${TIP}`]);
    });

    it('refuses unaskable, not claimed, and deletes nothing where the merge reading answers unknown', async () => {
      const { outcome, calls } = await run({ commits: claimedWork, pr: closed, merged: ok('unknown') });
      expect(outcome).toMatchObject({ kind: 'refused', reason: 'unaskable' });
      expect(calls).toEqual([]);
    });

    it('refuses unaskable and deletes nothing where the merge reading fails', async () => {
      const { outcome, calls } = await run({ commits: claimedWork, pr: closed, merged: silent() });
      expect(outcome).toMatchObject({ kind: 'refused', reason: 'unaskable' });
      expect(calls).toEqual([]);
    });
  });

  describe('through the shell host adapter', () => {
    const roots: string[] = [];
    afterAll(() => {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    });

    /** A `plot-host.sh` that answers `pr-state` with a closed PR and `pr-merged` with `merged`'s word and exit. */
    const hostAnswering = (mergedBody: string): LooseDeletePorts['host'] => {
      const root = mkdtempSync(join(tmpdir(), 'plot-loose-host-'));
      roots.push(root);
      const scriptDir = join(root, 'scripts');
      mkdirSync(scriptDir);
      const file = join(scriptDir, 'plot-host.sh');
      const pr = '{"number":1425,"state":"CLOSED","draft":false,"url":"","mergeCommit":"","head":"feature/x","base":"main","mergedAt":""}';
      writeFileSync(file, `#!/usr/bin/env bash\ncase "$1" in\n  pr-state) printf '%s\\n' '${pr}' ;;\n  pr-merged) ${mergedBody} ;;\n  *) exit 1 ;;\nesac\n`);
      chmodSync(file, 0o755);
      return hostShell({ repoRoot: root, scriptDir });
    };

    const claimedWork = ok([
      { subject: 'real work', tree: 't2', parentTree: 't1' },
      { subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' },
    ]);

    it('refuses unaskable where pr-merged answers unknown after a GraphQL rate refusal', async () => {
      // What `plot-host.sh pr-merged` printed on 2026-11-19 while GraphQL refused
      // the account: `unknown` on stdout, the host's words on stderr, exit 0.
      const host = hostAnswering(`echo 'plot-host: GraphQL: API rate limit already exceeded for user ID 870334.' >&2; echo unknown`);
      expect(await host.prMerged('feature/x')).toEqual({ ok: true, value: 'unknown' });
      const { outcome, calls } = await run({ commits: claimedWork, pr: await host.prState('feature/x'), merged: await host.prMerged('feature/x') });
      expect(outcome).toMatchObject({ kind: 'refused', reason: 'unaskable' });
      expect(calls).toEqual([]);
    });

    it('deletes where pr-merged answers not-merged for the closed PR', async () => {
      const host = hostAnswering('echo not-merged');
      const pr = await host.prState('feature/x');
      expect(pr).toMatchObject({ ok: true, value: { number: 1425, state: 'CLOSED' } });
      const { outcome } = await run({ commits: claimedWork, pr, merged: await host.prMerged('feature/x') });
      expect(outcome.kind).toBe('deleted');
    });
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
