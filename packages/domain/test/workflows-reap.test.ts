import { describe, it, expect } from 'vitest';
import { reap, type ReapCandidate, type ReapReadings } from '../src/workflows/index.js';
import type { Worktree } from '../src/entities/worktree.js';

const tree = (over: Partial<Worktree> = {}): Worktree => ({
  path: '/repo/.worktrees/plot-wt-one',
  branch: 'feature/one',
  isMain: false,
  clean: true,
  agentSession: 'sess-1',
  prunable: false,
  ...over,
});

/**
 * A finished desk whose work landed — every refusal passes.
 *
 * `hasLog` is false by default because a run that left no log is the case with
 * fewer writes: a fixture that opted INTO the extra write would make every
 * assertion about ordering carry a file the test was not about.
 */
const finished = (over: Partial<ReapCandidate> = {}): ReapCandidate => ({
  tree: tree(),
  evidence: {
    workerAlive: false,
    blockedMarker: false,
    hasMergedPr: true,
    isDispatchTree: true,
    manifest: '.plot/agents/sess-1.json',
    hasLog: false,
  },
  ...over,
});

const estate = (over: Partial<ReapReadings> = {}): ReapReadings => ({
  candidates: [finished()],
  orphanedManifests: [],
  defaultBranch: 'main',
  ...over,
});

describe('reap — the refusals, each a measurement', () => {
  it('keeps a tree with a live worker — the only signal about someone acting now', () => {
    const out = reap(
      estate({
        candidates: [finished({ evidence: { ...finished().evidence, workerAlive: true } })],
      }),
    );
    expect(out.detail.kept).toEqual([
      { path: '/repo/.worktrees/plot-wt-one', branch: 'feature/one', reason: 'live-worker' },
    ]);
    expect(out.writes).toEqual([]);
  });

  it('keeps a tree holding uncommitted work — it exists in exactly one place', () => {
    const out = reap(estate({ candidates: [finished({ tree: tree({ clean: false }) })] }));
    expect(out.detail.kept[0]?.reason).toBe('uncommitted-changes');
  });

  it('keeps a tree carrying a PLOT-BLOCKED marker — a worker waiting on a person', () => {
    const out = reap(
      estate({
        candidates: [finished({ evidence: { ...finished().evidence, blockedMarker: true } })],
      }),
    );
    expect(out.detail.kept[0]?.reason).toBe('blocked-marker');
  });

  it('keeps a tree on the default branch — its dispatched branch was never measured', () => {
    const out = reap(estate({ candidates: [finished({ tree: tree({ branch: 'main' }) })] }));
    expect(out.detail.kept[0]?.reason).toBe('on-default-branch');
  });

  it('keeps a branch no PR of which merged — an unreachable host is never permission', () => {
    const out = reap(
      estate({
        candidates: [finished({ evidence: { ...finished().evidence, hasMergedPr: false } })],
      }),
    );
    expect(out.detail.kept[0]?.reason).toBe('no-merged-pr');
  });

  it('reports the live worker first when several refusals apply at once', () => {
    const out = reap(
      estate({
        candidates: [
          finished({
            tree: tree({ clean: false }),
            evidence: { ...finished().evidence, workerAlive: true, blockedMarker: true },
          }),
        ],
      }),
    );
    expect(out.detail.kept[0]?.reason).toBe('live-worker');
  });

  it('passes over a hand-made worktree entirely — not ours to remove, not ours to report', () => {
    const out = reap(
      estate({
        candidates: [finished({ evidence: { ...finished().evidence, isDispatchTree: false } })],
      }),
    );
    expect(out.detail.kept).toEqual([]);
    expect(out.detail.reaping).toEqual([]);
  });
});

describe('reap — a decision names every removal', () => {
  it('removes the checkout BEFORE the manifest that named it', () => {
    const out = reap(estate());
    expect(out.writes).toEqual([
      { kind: 'worktree-remove', path: '/repo/.worktrees/plot-wt-one' },
      { kind: 'manifest-clear', worktree: '/repo/.worktrees/plot-wt-one' },
    ]);
  });

  it('removes the log LAST, after the checkout and the manifest', () => {
    // The order is the argument. The first two are ordered because the reverse
    // leaves a live worktree unregistered; the log is last because it is the
    // only one that is pure cleanup, so a failure before it has cost the least.
    const out = reap(
      estate({ candidates: [finished({ evidence: { ...finished().evidence, hasLog: true } })] }),
    );
    expect(out.writes).toEqual([
      { kind: 'worktree-remove', path: '/repo/.worktrees/plot-wt-one' },
      { kind: 'manifest-clear', worktree: '/repo/.worktrees/plot-wt-one' },
      { kind: 'log-clear', branch: 'feature/one' },
    ]);
  });

  it('still removes the log where no manifest named the tree', () => {
    // The log does not depend on the manifest: a tree registered by neither is
    // still a tree whose words are worth taking.
    const out = reap(
      estate({
        candidates: [finished({ evidence: { ...finished().evidence, manifest: '', hasLog: true } })],
      }),
    );
    expect(out.writes.map((w) => w.kind)).toEqual(['worktree-remove', 'log-clear']);
  });

  it('writes nothing for a log that is not there — absence is the desired state', () => {
    // A MISSING LOG IS NOT A REFUSAL, and it is not a write either. The reap
    // proceeds; there is simply nothing to remove.
    const out = reap(estate());
    expect(out.writes.some((w) => w.kind === 'log-clear')).toBe(false);
    expect(out.detail.reaping).toEqual(['/repo/.worktrees/plot-wt-one']);
  });

  it('takes no log from a tree it refused', () => {
    // A log describes the worktree, so a tree that stays keeps the words
    // explaining why it is there.
    const out = reap(
      estate({
        candidates: [
          finished({ evidence: { ...finished().evidence, hasMergedPr: false, hasLog: true } }),
        ],
      }),
    );
    expect(out.writes).toEqual([]);
  });

  it('removes the checkout alone where no manifest named it', () => {
    const out = reap(
      estate({ candidates: [finished({ evidence: { ...finished().evidence, manifest: '' } })] }),
    );
    expect(out.writes.map((w) => w.kind)).toEqual(['worktree-remove']);
  });

  it('sweeps a manifest whose worktree is already gone', () => {
    const out = reap(
      estate({
        candidates: [],
        orphanedManifests: [{ file: '.plot/agents/dead.json', worktree: '/repo/.worktrees/gone' }],
      }),
    );
    expect(out.writes).toEqual([{ kind: 'manifest-clear', worktree: '/repo/.worktrees/gone' }]);
    expect(out.detail.cleared).toEqual(['/repo/.worktrees/gone']);
  });

  it('decides with no writes on an estate with nothing to reap — never a refusal', () => {
    const out = reap(estate({ candidates: [] }));
    expect(out.outcome).toBe('decided');
    expect(out.writes).toEqual([]);
  });
});

describe('reap — the bound', () => {
  const three = estate({
    candidates: [
      finished({ tree: tree({ path: '/repo/.worktrees/plot-wt-a', branch: 'feature/a' }) }),
      finished({ tree: tree({ path: '/repo/.worktrees/plot-wt-b', branch: 'feature/b' }) }),
      finished({ tree: tree({ path: '/repo/.worktrees/plot-wt-c', branch: 'feature/c' }) }),
    ],
  });

  it('stops at --max and names the bound rather than a failed test', () => {
    const out = reap(three, { max: 2 });
    expect(out.detail.reaping).toHaveLength(2);
    expect(out.detail.kept).toEqual([
      { path: '/repo/.worktrees/plot-wt-c', branch: 'feature/c', reason: 'max-reached' },
    ]);
  });

  it('reaps everything reapable when unbounded', () => {
    expect(reap(three).detail.reaping).toHaveLength(3);
    expect(reap(three, { max: 0 }).detail.reaping).toHaveLength(3);
  });

  it('sweeps orphaned manifests regardless of the bound — they remove no checkout', () => {
    const out = reap(
      estate({
        ...three,
        orphanedManifests: [{ file: '.plot/agents/dead.json', worktree: '/repo/.worktrees/gone' }],
      }),
      { max: 1 },
    );
    expect(out.detail.cleared).toEqual(['/repo/.worktrees/gone']);
  });
});
