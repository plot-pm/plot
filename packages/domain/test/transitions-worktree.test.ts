import { describe, expect, it } from 'vitest';
import { WorktreeStateSchema, type WorktreeState } from '../src/entities/worktree.js';
import type { TreeReadings } from '../src/rules/reapable.js';
import { reapProblems } from '../src/rules/reapable.js';
import {
  isDecision,
  isRefusal,
  observeWorktreeState,
  removalIsRecreatable,
  REMOVAL_IS_RECREATABLE,
  worktreeStateObservable,
  type RemovalTarget,
} from '../src/transitions/worktree.js';

/** The desk every case uses — one path, so a refusal's subject is never in doubt. */
const DESK = '.worktrees/plot-wt-feature-a-worktree-lifecycle-refuses';

/** The plan that bounds a ref deletion, where a case supplies one. */
const PLAN = '2026-09-04-a-lifecycle-is-enforced-by-a-test';

/**
 * A tree that passes all five refusals — the only readings `finished ->
 * reapable` accepts.
 *
 * Every refusal case below is this with ONE field spoiled, so a test that
 * fails names the measurement it broke rather than the fixture.
 */
const reapable = (): TreeReadings => ({
  branch: 'feature/a-worktree-lifecycle-refuses',
  defaultBranch: 'main',
  isMain: false,
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'merged',
});

/** Observes a move, supplying readings that pass where the move needs them. */
const move = (from: WorktreeState, to: WorktreeState) =>
  observeWorktreeState(DESK, from, { to, readings: reapable() });

describe('the fixture is a real violation, not a convenient one', () => {
  it('passes every reap refusal before any case spoils it', () => {
    expect(reapProblems(reapable())).toEqual([]);
  });
});

describe('observeWorktreeState judges a move the lifecycle diagram allows', () => {
  it('lets a dispatch cut a desk and an agent take it', () => {
    const result = move('created', 'occupied');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.from).toBe('created');
    expect(result.to).toBe('occupied');
    expect(result.destroys).toBeNull();
  });

  it('lets a worker exit and the desk become finished', () => {
    expect(isDecision(move('occupied', 'finished'))).toBe(true);
  });

  it('lets a hand-made tree reach finished without ever being occupied', () => {
    // The population `plot-dispatch.sh` describes as having no claim ref: cut
    // by a person, never dispatched, so no worker ever ran in it.
    expect(isDecision(move('created', 'finished'))).toBe(true);
  });

  it('lets a measured desk become reapable when all five refusals pass', () => {
    expect(isDecision(move('finished', 'reapable'))).toBe(true);
  });

  it('lets a reap remove a reapable checkout, and says that is what it costs', () => {
    const result = move('reapable', 'gone');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.destroys).toBe('checkout');
  });

  it('walks the whole diagram end to end', () => {
    const path: readonly WorktreeState[] = [
      'created',
      'occupied',
      'finished',
      'reapable',
      'gone',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(isDecision(move(path[i], path[i + 1]))).toBe(true);
    }
  });
});

describe('observeWorktreeState refuses a move the diagram does not draw', () => {
  it('refuses a state no schema admits', () => {
    const result = observeWorktreeState(DESK, 'created', { to: 'archived' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unrecognised');
    expect(result.detail).toContain('archived');
  });

  it('refuses a move to the state already held', () => {
    const result = observeWorktreeState(DESK, 'occupied', { to: 'occupied' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unchanged');
  });

  it('refuses every move out of gone, because the lifecycle ended there', () => {
    for (const to of WorktreeStateSchema.options) {
      if (to === 'gone') continue;
      const result = observeWorktreeState(DESK, 'gone', { to, readings: reapable() });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('state-terminal');
    }
  });

  it('says a re-created desk is a new one rather than a resumed one', () => {
    const result = observeWorktreeState(DESK, 'gone', { to: 'created' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('git worktree add');
    expect(result.detail).toContain('new desk');
  });

  it('refuses skipping the reap gate: finished cannot go straight to gone', () => {
    // The move that would remove a checkout without measuring it — exactly what
    // the five refusals exist to stop.
    const result = observeWorktreeState(DESK, 'finished', { to: 'gone', readings: reapable() });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('refuses running a worker in a desk that is already finished', () => {
    const result = observeWorktreeState(DESK, 'finished', { to: 'occupied' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('refuses reaping a desk whose worker is still alive in it', () => {
    const result = observeWorktreeState(DESK, 'occupied', { to: 'reapable', readings: reapable() });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('names what the state it refused could have become', () => {
    const result = observeWorktreeState(DESK, 'occupied', { to: 'reapable' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('finished');
  });
});

describe('finished -> reapable consumes the reap rule rather than re-deriving it', () => {
  it('refuses when nobody measured the tree', () => {
    // *Nobody looked* is not *every refusal passed* — the direction
    // `rules/reapable.ts` already fails in when the host cannot be asked.
    const result = observeWorktreeState(DESK, 'finished', { to: 'reapable' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reap-refused');
    expect(result.detail).toContain('nobody looked');
  });

  it('refuses a live worker pid, and names it', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), workerPid: '4242' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reap-refused');
    expect(result.detail).toContain('live-worker');
    expect(result.detail).toContain('4242');
  });

  it('refuses uncommitted changes, and names the path', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), dirtyPath: 'packages/domain/src/transitions/worktree.ts' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('uncommitted-changes');
    expect(result.detail).toContain('packages/domain/src/transitions/worktree.ts');
  });

  it('refuses a PLOT-BLOCKED marker, because it holds a question for a person', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), blockedMarker: true },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('blocked-marker');
  });

  it('refuses a tree sitting on the default branch, whose state was never measured', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), branch: 'main' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('on-default-branch');
  });

  it('refuses the main checkout', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), isMain: true },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('on-default-branch');
  });

  it('refuses a branch the host did not merge', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), merge: 'not-merged' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('no-merged-pr');
  });

  it('refuses an unreachable host exactly as it refuses an unmerged branch', () => {
    // Silence is never permission.
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), merge: 'unreachable' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('no-merged-pr');
  });

  it('reports every refusal that applies, most urgent first', () => {
    const result = observeWorktreeState(DESK, 'finished', {
      to: 'reapable',
      readings: { ...reapable(), workerPid: '4242', blockedMarker: true, merge: 'not-merged' },
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail.indexOf('live-worker')).toBeLessThan(
      result.detail.indexOf('blocked-marker'),
    );
    expect(result.detail).toContain('no-merged-pr');
  });

  it('agrees with the rule it delegates to, refusal for refusal', () => {
    // The delegation is the point: a second implementation of *may this be
    // removed* is the drift that deletes somebody's work.
    const spoiled: TreeReadings = { ...reapable(), workerPid: '77', dirtyPath: 'a.ts' };
    expect(reapProblems(spoiled).length).toBeGreaterThan(0);
    expect(isRefusal(observeWorktreeState(DESK, 'finished', { to: 'reapable', readings: spoiled })))
      .toBe(true);
  });
});

describe('a removal says what it destroys and whether git can undo it', () => {
  it('holds the asymmetry as data, not as prose', () => {
    expect(REMOVAL_IS_RECREATABLE.checkout).toBe(true);
    expect(REMOVAL_IS_RECREATABLE.ref).toBe(false);
  });

  it('allows removing a checkout, because git worktree add puts it back', () => {
    const result = removalIsRecreatable(DESK, { target: 'checkout' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.destroys).toBe('checkout');
    expect(result.to).toBe('gone');
  });

  it('refuses deleting a ref even when a plan bounds it, and says who owns that act', () => {
    const result = removalIsRecreatable(DESK, { target: 'ref', planSlug: PLAN });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('removal-not-recreatable');
    expect(result.detail).toContain('not re-creatable');
    expect(result.detail).toContain('git worktree add');
  });

  it('refuses a ref deletion bounded by no plan, naming the blast radius', () => {
    const result = removalIsRecreatable(DESK, { target: 'ref' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('removal-scope-unbounded');
    expect(result.detail).toContain('plan');
  });

  it('refuses the unbounded sweep before the unrecoverable act', () => {
    // Both refuse; the scope one fires first because it describes the wider
    // damage — a sweep over every merged ref on the estate.
    const unbounded = removalIsRecreatable(DESK, { target: 'ref' });
    const bounded = removalIsRecreatable(DESK, { target: 'ref', planSlug: PLAN });
    expect(isRefusal(unbounded) && unbounded.reason).toBe('removal-scope-unbounded');
    expect(isRefusal(bounded) && bounded.reason).toBe('removal-not-recreatable');
  });

  it('does not let a plan slug make a ref deletion look like a checkout removal', () => {
    // The asymmetry is the whole assertion: bounding the scope of an
    // unrecoverable act does not make it recoverable.
    for (const planSlug of ['', PLAN]) {
      expect(isRefusal(removalIsRecreatable(DESK, { target: 'ref', planSlug }))).toBe(true);
    }
    expect(isDecision(removalIsRecreatable(DESK, { target: 'checkout' }))).toBe(true);
  });

  it('covers every removal target the type admits', () => {
    const targets: readonly RemovalTarget[] = ['checkout', 'ref'];
    for (const target of targets) {
      const result = removalIsRecreatable(DESK, { target, planSlug: PLAN });
      expect(isDecision(result) || isRefusal(result)).toBe(true);
      expect(isDecision(result)).toBe(REMOVAL_IS_RECREATABLE[target]);
    }
  });
});

describe('a caller-supplied reading refuses on its own', () => {
  it('refuses a state move when a precondition is unmet', () => {
    const result = observeWorktreeState(DESK, 'created', {
      to: 'occupied',
      preconditions: [{ name: 'worktree-listable', met: false, detail: 'git worktree list failed' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('worktree-listable');
    expect(result.detail).toContain('git worktree list failed');
  });

  it('refuses a removal when a precondition is unmet', () => {
    const result = removalIsRecreatable(DESK, {
      target: 'checkout',
      preconditions: [{ name: 'lock-held', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('lock-held');
  });

  it('takes the first unmet reading when several refuse', () => {
    const result = observeWorktreeState(DESK, 'created', {
      to: 'occupied',
      preconditions: [
        { name: 'first', met: false },
        { name: 'second', met: false },
      ],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('first');
    expect(result.detail).not.toContain('second');
  });

  it('passes when every reading is met', () => {
    const result = observeWorktreeState(DESK, 'created', {
      to: 'occupied',
      preconditions: [{ name: 'worktree-listable', met: true }],
    });
    expect(isDecision(result)).toBe(true);
  });

  it('checks the diagram before the readings, so an illegal move refuses as one', () => {
    const result = observeWorktreeState(DESK, 'gone', {
      to: 'occupied',
      preconditions: [{ name: 'anything', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });
});

describe('the offer is separate from the act', () => {
  it('agrees with observeWorktreeState on every ordered pair of states', () => {
    for (const from of WorktreeStateSchema.options) {
      for (const to of WorktreeStateSchema.options) {
        const readings = reapable();
        expect(worktreeStateObservable(DESK, from, to, readings)).toBe(
          isDecision(observeWorktreeState(DESK, from, { to, readings })),
        );
      }
    }
  });

  it('is not a permission — the act re-checks what the offer answered', () => {
    // The offer said yes with readings; the act refuses without them.
    expect(worktreeStateObservable(DESK, 'finished', 'reapable', reapable())).toBe(true);
    expect(isRefusal(observeWorktreeState(DESK, 'finished', { to: 'reapable' }))).toBe(true);
  });
});

describe('a refusal is assertable as a value', () => {
  it('names the desk it is about', () => {
    const result = observeWorktreeState(DESK, 'gone', { to: 'created' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.path).toBe(DESK);
  });

  it('is branched on by reason rather than matched as prose', () => {
    const result = removalIsRecreatable(DESK, { target: 'ref', planSlug: PLAN });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('removal-not-recreatable');
    expect(result.outcome).toBe('refused');
  });

  it('is never both a decision and a refusal', () => {
    const results = [
      observeWorktreeState(DESK, 'created', { to: 'occupied' }),
      observeWorktreeState(DESK, 'gone', { to: 'created' }),
      removalIsRecreatable(DESK, { target: 'checkout' }),
      removalIsRecreatable(DESK, { target: 'ref' }),
    ];
    for (const result of results) {
      expect(isDecision(result)).toBe(!isRefusal(result));
    }
  });
});
