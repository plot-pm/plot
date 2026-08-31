import { describe, it, expect } from 'vitest';
import {
  stopWorker,
  restartWorker,
  migrateWorktrees,
  decided,
  refused,
  type WorktreeReading,
  type BranchPrReading,
} from '../src/workflows/index.js';

/**
 * The three verbs that run BEFORE the phase gate, asserted as values.
 *
 * `--stop`, `--restart` and `--migrate` act on work already in flight, so each
 * refusal here protects somebody's desk: a live worker, a marker waiting on a
 * person, a tree holding uncommitted work. The shell refuses on the same
 * measurements; these tests assert the refusals without spawning anything.
 *
 * WHAT MAKES A REFUSAL WORTH A TEST: it must be reachable. Every case below
 * names the reading that produces it, so a guard that stops firing fails here
 * rather than in an estate where the loss is real.
 */

const tree = (over: Partial<WorktreeReading> = {}): WorktreeReading => ({
  branch: 'feature/x',
  path: '/wt/feature-x',
  state: 'finished',
  pid: '',
  blockedMarker: '',
  dirty: false,
  ...over,
});

const pr = (over: Partial<BranchPrReading> = {}): BranchPrReading => ({
  reachedReview: false,
  number: 0,
  state: '',
  ...over,
});

describe('--stop: the branch is explicit, and stopping is signalling', () => {
  it('refuses an empty branch rather than guessing which worker to stop', () => {
    const out = stopWorker({ branch: '', tree: null });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('branch-missing');
  });

  it('refuses a branch no worktree holds', () => {
    const out = stopWorker({ branch: 'feature/x', tree: null });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('no-worktree');
  });

  it('signals only a RUNNING worker, and names the pid it will signal', () => {
    const out = stopWorker({ branch: 'feature/x', tree: tree({ state: 'running', pid: '4242' }) });
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.signalling).toBe(true);
      expect(out.detail.pid).toBe('4242');
      expect(out.writes).toEqual([{ kind: 'worker-signal', pid: '4242', branch: 'feature/x' }]);
    }
  });

  it('decides WITHOUT a write where no worker is running — nothing to signal is not a refusal', () => {
    // The desk exists and is empty. `--stop` succeeds and does nothing, which
    // is different from refusing: the operator asked for a state that already holds.
    const out = stopWorker({ branch: 'feature/x', tree: tree({ state: 'finished', pid: '999' }) });
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.signalling).toBe(false);
      expect(out.detail.pid).toBe('');
      expect(out.writes).toEqual([]);
    }
  });
});

describe('--restart: the PR is asked FIRST, before the state word', () => {
  it('refuses an empty branch — a restart is never auto-selected', () => {
    const out = restartWorker({ branch: '', tree: null, pr: pr() });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('branch-missing');
  });

  it('refuses a branch no worktree holds', () => {
    const out = restartWorker({ branch: 'feature/x', tree: null, pr: pr() });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('no-worktree');
  });

  it('refuses a branch that reached review, EVEN when its worker state invites a restart', () => {
    // The load-bearing ordering. Five of five `failed` worktrees measured on
    // this estate held a PR, so a gate on the state word alone would restart
    // all five and destroy what the `finished` refusal protects.
    const out = restartWorker({
      branch: 'feature/x',
      tree: tree({ state: 'failed' }),
      pr: pr({ reachedReview: true, number: 7, state: 'OPEN' }),
    });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('reached-review');
  });

  it('refuses a live worker — a restart would discard work in progress', () => {
    const out = restartWorker({
      branch: 'feature/x',
      tree: tree({ state: 'running', pid: '1234' }),
      pr: pr(),
    });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('worker-alive');
  });

  it('refuses a worker waiting on a person, naming the marker', () => {
    const out = restartWorker({
      branch: 'feature/x',
      tree: tree({ state: 'waiting', blockedMarker: 'PLOT-BLOCKED.md' }),
      pr: pr(),
    });
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('blocked-marker');
  });

  it('restarts a failed worker with no PR, inheriting the tree untouched', () => {
    // A `failed` worker with no PR MUST restart, or the verb cannot do its job.
    // The worktree is inherited rather than recreated: a stall IS uncommitted
    // work, and one measured here left 324 finished lines on the floor.
    const out = restartWorker({
      branch: 'feature/x',
      tree: tree({ state: 'failed', path: '/wt/feature-x', dirty: true }),
      pr: pr(),
    });
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.writes).toEqual([
        { kind: 'worker-start', branch: 'feature/x', worktree: '/wt/feature-x' },
      ]);
    }
  });
});

describe('--migrate: every refusal is a measurement, and a dry run writes nothing', () => {
  const candidate = (over: Partial<WorktreeReading>, unpushedCommits = false) => ({
    tree: tree(over),
    unpushedCommits,
  });

  it('refuses when no worktree root is configured', () => {
    const out = migrateWorktrees(
      { configuredRoot: '', legacyRoot: '/legacy', candidates: [] },
      { yes: true },
    );
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('root-unconfigured');
  });

  it('refuses when the configured root IS the legacy root — there is nowhere to move to', () => {
    const out = migrateWorktrees(
      { configuredRoot: '/same', legacyRoot: '/same', candidates: [] },
      { yes: true },
    );
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('root-is-legacy');
  });

  it('moves a quiet, clean, pushed worktree and names its destination', () => {
    const out = migrateWorktrees(
      {
        configuredRoot: '/.worktrees',
        legacyRoot: '/legacy',
        candidates: [candidate({ branch: 'feature/a-b', path: '/legacy/plot-wt-feature-a-b' })],
      },
      { yes: true },
    );
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.moving).toHaveLength(1);
      expect(out.writes).toEqual([
        {
          kind: 'worktree-move',
          from: '/legacy/plot-wt-feature-a-b',
          to: '/.worktrees/feature-a-b',
        },
      ]);
    }
  });

  it('keeps each of the four measured refusals, and never conflates them', () => {
    // Liveness and unlanded work refuse SEPARATELY: the worker state alone
    // misses a hand-made dirty worktree that no worker ever ran in.
    const out = migrateWorktrees(
      {
        configuredRoot: '/.worktrees',
        legacyRoot: '/legacy',
        candidates: [
          candidate({ branch: 'feature/live', state: 'running', pid: '1' }),
          candidate({ branch: 'feature/wait', state: 'waiting', blockedMarker: 'PLOT-BLOCKED' }),
          candidate({ branch: 'feature/dirty', dirty: true }),
          candidate({ branch: 'feature/unpushed' }, true),
        ],
      },
      { yes: true },
    );
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.moving).toEqual([]);
      expect(out.detail.kept.map((k) => k.reason)).toEqual([
        'worker-alive',
        'blocked-marker',
        'uncommitted',
        'unpushed-commits',
      ]);
      expect(out.writes).toEqual([]);
    }
  });

  it('describes the move but emits NO write on a dry run — the default', () => {
    // `yes` omitted is a dry run, which is the safe default the script keeps.
    const out = migrateWorktrees(
      {
        configuredRoot: '/.worktrees',
        legacyRoot: '/legacy',
        candidates: [candidate({ branch: 'feature/x' })],
      },
      {},
    );
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.dryRun).toBe(true);
      expect(out.detail.moving).toHaveLength(1);
      expect(out.writes).toEqual([]);
    }
  });

  it('bounds the move by --max, leaving the remainder unreported as kept', () => {
    const out = migrateWorktrees(
      {
        configuredRoot: '/.worktrees',
        legacyRoot: '/legacy',
        candidates: [
          candidate({ branch: 'feature/one' }),
          candidate({ branch: 'feature/two' }),
          candidate({ branch: 'feature/three' }),
        ],
      },
      { yes: true, max: 2 },
    );
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail.moving).toHaveLength(2);
      expect(out.writes).toHaveLength(2);
    }
  });
});
