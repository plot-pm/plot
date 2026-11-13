// `stateSyncGateFor` over stand-in ports: what the gate fetches before it
// diffs, and which of Plot's own writes its path set admits.
import { describe, expect, it } from 'vitest';
import { briefPath } from '@plot-pm/domain/rules/brief-path';
import { HOLD_FILE } from '@plot-pm/domain/rules/hold-clear';
import { syncPathVerdict } from '@plot-pm/domain/rules/state-sync';
import { stateSyncGateFor } from '../../src/server/entry/state-sync-gate.js';

const TIP = 'abc1234def';

const harness = (opts: { files?: readonly string[]; defaultFetch?: 'ok' | 'missing' | 'failed'; key?: string | 'failed'; main?: 'failed' } = {}) => {
  const fetched: Array<[string, string]> = [];
  const config = async (key: string, fallback: string) => {
    if (key !== 'State branch') return { ok: true as const, value: fallback };
    return opts.key === 'failed' ? { ok: false as const, error: { kind: 'failed' as const } } : { ok: true as const, value: opts.key ?? 'plot/state' };
  };
  const deps = {
    repoRoot: '/repo',
    refs: {
      defaultBranch: async () => (opts.main === 'failed' ? { ok: false as const, error: { kind: 'failed' } } : { ok: true as const, value: 'main' }),
      resolve: async () => ({ ok: true as const, value: TIP }),
      changedFiles: async () => ({ ok: true as const, value: [...(opts.files ?? [])] }),
    },
    trees: {
      fetchRef: async (_root: string, ref: string, into: string) => {
        fetched.push([ref, into]);
        if (ref === 'refs/heads/main' && opts.defaultFetch === 'failed') return { ok: false as const, error: { kind: 'failed' } };
        if (ref === 'refs/heads/main' && opts.defaultFetch === 'missing') return { ok: true as const, value: false };
        return { ok: true as const, value: true };
      },
    },
  };
  return { config, deps, fetched };
};

describe('stateSyncGateFor', () => {
  it('passes a sync diff that carries a brief and the hold file', async () => {
    const files = ['docs/plans/2026-11-07-x.md', briefPath('feature/state-branch-sync'), HOLD_FILE];
    const h = harness({ files });
    const gate = await stateSyncGateFor(h.config as never, h.deps as never);
    if (gate === null || 'unread' in gate) throw new Error('expected a gate');
    const diff = await gate.diff(TIP);
    expect(diff).toEqual(files);
    expect(syncPathVerdict(diff, gate.pathSet)).toEqual({ ok: true });
  });

  it('fetches the default branch before it diffs, so a stale local copy cannot move the merge base', async () => {
    const h = harness({ files: ['docs/plans/a.md'] });
    const gate = await stateSyncGateFor(h.config as never, h.deps as never);
    if (gate === null || 'unread' in gate) throw new Error('expected a gate');
    await gate.diff(TIP);
    expect(h.fetched).toEqual([
      ['refs/heads/plot/state', 'refs/remotes/origin/plot/state'],
      ['refs/heads/main', 'refs/remotes/origin/main'],
    ]);
  });

  it('reads the diff as unknown where the default branch could not be fetched', async () => {
    for (const defaultFetch of ['failed', 'missing'] as const) {
      const h = harness({ files: ['docs/plans/a.md'], defaultFetch });
      const gate = await stateSyncGateFor(h.config as never, h.deps as never);
      if (gate === null || 'unread' in gate) throw new Error('expected a gate');
      expect(await gate.diff(TIP)).toBe('unknown');
    }
  });

  it('answers an unread gate where the State branch key could not be read', async () => {
    expect(await stateSyncGateFor(harness({ key: 'failed' }).config as never, harness().deps as never))
      .toEqual({ unread: 'state-branch-key', target: 'unknown', defaultBranch: 'main' });
    const both = harness({ key: 'failed', main: 'failed' });
    expect(await stateSyncGateFor(both.config as never, both.deps as never))
      .toEqual({ unread: 'state-branch-key', target: 'unknown', defaultBranch: 'unknown' });
  });

  it('answers an unread gate naming the state branch where the default branch could not be read', async () => {
    const h = harness({ main: 'failed' });
    expect(await stateSyncGateFor(h.config as never, h.deps as never))
      .toMatchObject({ unread: 'default-branch', target: { pushRef: 'refs/heads/plot/state' }, defaultBranch: 'unknown' });
  });

  it('answers no gate where no key is declared, even with the default branch unread', async () => {
    const h = harness({ key: '', main: 'failed' });
    expect(await stateSyncGateFor(h.config as never, h.deps as never)).toBeNull();
  });
});
