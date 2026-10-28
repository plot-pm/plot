import { describe, it, expect } from 'vitest';
import {
  stopWorker,
  restartWorker,
  migrateWorktrees,
  releaseClaim,
  decided,
  refused,
  type WorktreeReading,
  type BranchPrReading,
  type ClaimReleaseReadings,
  type ClaimReleasePrReading,
} from '../src/workflows/index.js';
import { answered, failed, unaskable } from '../src/port-result.js';

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

describe('--restart: the PR is asked FIRST, then the loop, then the marker', () => {
  const none = { kind: 'none' } as const;
  const alive = { kind: 'alive', pid: '4242', source: '.plot-worker.pid' } as const;
  const restart = (over: Partial<Parameters<typeof restartWorker>[0]> = {}) =>
    restartWorker({
      branch: 'feature/x',
      tree: tree({ state: 'failed' }),
      pr: pr(),
      loop: none,
      unattended: false,
      ...over,
    });
  const reason = (out: ReturnType<typeof restartWorker>) => (refused(out) ? out.reason : 'decided');

  it('refuses an empty branch — a restart is never auto-selected', () => {
    expect(reason(restart({ branch: '', tree: null }))).toBe('branch-missing');
  });

  it('refuses a branch no worktree holds', () => {
    expect(reason(restart({ tree: null }))).toBe('no-worktree');
  });

  it('refuses an unattended caller', () => {
    expect(reason(restart({ unattended: true }))).toBe('unattended');
  });

  it('refuses a branch that reached review, EVEN when its worker state invites a restart', () => {
    // Five of five `failed` worktrees measured on this estate held a PR.
    const out = restart({ pr: pr({ reachedReview: true, number: 7, state: 'OPEN' }) });
    expect(reason(out)).toBe('reached-review');
  });

  it('refuses when the host could not say — absent is not "no PR"', () => {
    expect(reason(restart({ pr: pr({ reachedReview: 'unanswerable' }) }))).toBe('pr-unanswerable');
  });

  it('refuses reached-review before loop-alive and blocked-marker', () => {
    const out = restart({
      tree: tree({ state: 'waiting', blockedMarker: 'PLOT-BLOCKED.md' }),
      pr: pr({ reachedReview: true, number: 7, state: 'OPEN' }),
      loop: alive,
    });
    expect(reason(out)).toBe('reached-review');
  });

  it('refuses loop-alive before blocked-marker', () => {
    const out = restart({
      tree: tree({ state: 'waiting', blockedMarker: 'PLOT-BLOCKED.md' }),
      loop: alive,
    });
    expect(reason(out)).toBe('loop-alive');
  });

  it('refuses loop-alive on a failed state with a live loop reading', () => {
    expect(reason(restart({ tree: tree({ state: 'failed' }), loop: alive }))).toBe('loop-alive');
  });

  it('refuses a live worker — a restart would discard work in progress', () => {
    const out = restart({ tree: tree({ state: 'running', pid: '1234' }) });
    expect(reason(out)).toBe('worker-alive');
  });

  it('refuses a finished worker — the reaper and continue own that desk', () => {
    expect(reason(restart({ tree: tree({ state: 'finished' }) }))).toBe('worker-finished');
  });

  it('refuses a worker waiting on a person, naming the marker', () => {
    const out = restart({ tree: tree({ state: 'waiting', blockedMarker: 'PLOT-BLOCKED.md' }) });
    expect(reason(out)).toBe('blocked-marker');
  });

  it.each(['stalled', 'failed', 'ended', 'none'] as const)('restarts a %s worker with no PR', (state) => {
    expect(reason(restart({ tree: tree({ state }) }))).toBe('decided');
  });

  it('restarts a failed worker with no PR, inheriting the tree untouched', () => {
    const out = restart({ tree: tree({ state: 'failed', path: '/wt/feature-x', dirty: true }) });
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

describe('--release: two refusals, not the script\'s six', () => {
  const readings = (over: Partial<ClaimReleaseReadings> = {}): ClaimReleaseReadings => ({
    branch: 'feature/x',
    claimed: true,
    holders: [],
    pr: answered({ open: false, merged: false, number: 0, state: '' }),
    ...over,
  });

  it('refuses an empty branch rather than guessing which claim to release', () => {
    const out = releaseClaim(readings({ branch: '' }));
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('branch-missing');
  });

  it('decides WITHOUT a write when the branch holds no claim at all', () => {
    // Neither a live agent nor a PR applies to a branch nothing names — this
    // is the script's own `Nothing to release.`, exit 0.
    const out = releaseClaim(readings({ claimed: false, holders: ['session-1'] }));
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail).toEqual({ branch: 'feature/x', hadClaim: false });
      expect(out.writes).toEqual([]);
    }
  });

  it('refuses a live agent, read from the manifest holders — stopping is not abandoning', () => {
    const out = releaseClaim(readings({ holders: ['session-42'] }));
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('agent-live');
  });

  it('refuses an open PR', () => {
    const out = releaseClaim(
      readings({ pr: answered({ open: true, merged: false, number: 7, state: 'OPEN' }) }),
    );
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('pr-open');
  });

  it('refuses a MERGED pr-open — a merged ref is plot-release-refs.sh\'s to release, not this one\'s', () => {
    const out = releaseClaim(
      readings({ pr: answered({ open: false, merged: true, number: 7, state: 'MERGED' }) }),
    );
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('pr-open');
  });

  it('refuses when the host could not answer — silence is not permission', () => {
    const out = releaseClaim(readings({ pr: failed() }));
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('pr-open');
  });

  it('refuses when the host is unaskable, exactly as a failed call does', () => {
    const out = releaseClaim(readings({ pr: unaskable() }));
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('pr-open');
  });

  it('releases on claim-only local evidence when the host did not answer, and says so', () => {
    for (const pr of [failed<ClaimReleasePrReading>(), unaskable<ClaimReleasePrReading>()]) {
      const out = releaseClaim(readings({ pr, localEvidence: 'claim-only' }));
      expect(decided(out)).toBe(true);
      if (decided(out)) {
        expect(out.detail).toEqual({ branch: 'feature/x', hadClaim: true, viaLocalEvidence: true });
        expect(out.writes).toEqual([{ kind: 'claim-release', branch: 'feature/x' }]);
      }
    }
  });

  it('refuses an unanswered host when the local evidence is unknown', () => {
    const out = releaseClaim(readings({ pr: failed(), localEvidence: 'unknown' }));
    expect(refused(out)).toBe(true);
  });

  it('lets an answered open or merged PR outrank claim-only evidence', () => {
    for (const pr of [
      answered({ open: true, merged: false, number: 7, state: 'OPEN' }),
      answered({ open: false, merged: true, number: 7, state: 'MERGED' }),
    ]) {
      const out = releaseClaim(readings({ pr, localEvidence: 'claim-only' }));
      expect(refused(out)).toBe(true);
    }
  });

  it('refuses a live holder even with claim-only evidence', () => {
    const out = releaseClaim(readings({ pr: failed(), holders: ['s1'], localEvidence: 'claim-only' }));
    expect(refused(out)).toBe(true);
    if (refused(out)) expect(out.reason).toBe('agent-live');
  });

  it('releases a claimed branch with no live agent and no PR, naming one write', () => {
    const out = releaseClaim(readings());
    expect(decided(out)).toBe(true);
    if (decided(out)) {
      expect(out.detail).toEqual({ branch: 'feature/x', hadClaim: true });
      expect(out.writes).toEqual([{ kind: 'claim-release', branch: 'feature/x' }]);
    }
  });
});
