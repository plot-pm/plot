import { describe, expect, it } from 'vitest';
import {
  firstMoveRefusal,
  isMovableTree,
  moveProblems,
  type MoveReadings,
} from '../src/rules/movable.js';

/**
 * A movable tree: nothing running, nothing waiting, nothing on the floor, and
 * every commit already at the upstream. Each test names only what it changes,
 * so the reading under test is the only difference from a tree that moves.
 */
const idle = (over: Partial<MoveReadings> = {}): MoveReadings => ({
  activity: 'other',
  activePid: '',
  dirtyPath: '',
  ahead: 0,
  ...over,
});

describe('moveProblems', () => {
  it('refuses nothing for an idle tree', () => {
    expect(moveProblems(idle())).toEqual([]);
    expect(isMovableTree(idle())).toBe(true);
    expect(firstMoveRefusal(idle())).toBeNull();
  });

  // Each refusal individually triggerable, which is the whole point of moving
  // them out of shell: in `plot-dispatch.sh` they were four `if`s nothing could
  // reach in isolation.
  it('refuses a live process, naming the pid', () => {
    expect(moveProblems(idle({ activity: 'running', activePid: '4242' }))).toEqual([
      { refusal: 'live-worker', detail: '4242' },
    ]);
  });

  it('refuses a tree waiting on a person', () => {
    expect(moveProblems(idle({ activity: 'waiting' }))).toEqual([
      { refusal: 'blocked-marker', detail: '' },
    ]);
  });

  it('refuses uncommitted work, naming the file', () => {
    expect(moveProblems(idle({ dirtyPath: 'scratch.ts' }))).toEqual([
      { refusal: 'uncommitted-changes', detail: 'scratch.ts' },
    ]);
  });

  it('refuses unpushed commits, naming how many', () => {
    expect(moveProblems(idle({ ahead: 3 }))).toEqual([
      { refusal: 'unpushed-commits', detail: '3' },
    ]);
  });

  // An unanswered question is not a refusal. A branch with no upstream cannot
  // be asked whether its commits were pushed, and refusing there would keep
  // every worktree in a remote-less repo.
  it('does not refuse a branch whose upstream cannot be asked', () => {
    expect(moveProblems(idle({ ahead: 'unknown' }))).toEqual([]);
    expect(isMovableTree(idle({ ahead: 'unknown' }))).toBe(true);
  });

  it('does not refuse a branch level with its upstream', () => {
    expect(moveProblems(idle({ ahead: 0 }))).toEqual([]);
  });

  // Liveness and the tree are asked SEPARATELY. A hand-made worktree never ran
  // a dispatched process, so it reads `other` however dirty it is — and those
  // are precisely the trees a migration exists to tidy.
  it('refuses a dirty tree that no classifier calls live', () => {
    expect(moveProblems(idle({ activity: 'other', dirtyPath: 'f.txt' }))).toEqual([
      { refusal: 'uncommitted-changes', detail: 'f.txt' },
    ]);
  });

  // The combinations a live estate will not produce on demand.
  it('reports every refusal that applies, most urgent first', () => {
    const busy = idle({
      activity: 'running',
      activePid: '99',
      dirtyPath: 'a.ts',
      ahead: 2,
    });
    expect(moveProblems(busy)).toEqual([
      { refusal: 'live-worker', detail: '99' },
      { refusal: 'uncommitted-changes', detail: 'a.ts' },
      { refusal: 'unpushed-commits', detail: '2' },
    ]);
    expect(firstMoveRefusal(busy)).toEqual({ refusal: 'live-worker', detail: '99' });
    expect(isMovableTree(busy)).toBe(false);
  });

  it('puts a blocked marker ahead of the tree readings', () => {
    const blocked = idle({ activity: 'waiting', dirtyPath: 'b.ts', ahead: 1 });
    expect(firstMoveRefusal(blocked)).toEqual({ refusal: 'blocked-marker', detail: '' });
  });

  // `running` and `waiting` are one classifier's two answers, so a tree cannot
  // be both — the rule reads them from one field rather than from two flags
  // that could disagree.
  it('never reports both process refusals at once', () => {
    for (const activity of ['running', 'waiting', 'other'] as const) {
      const process = moveProblems(idle({ activity, activePid: '7' }))
        .filter((p) => p.refusal === 'live-worker' || p.refusal === 'blocked-marker');
      expect(process.length).toBeLessThanOrEqual(1);
    }
  });
});
