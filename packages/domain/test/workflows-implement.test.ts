import { describe, it, expect } from 'vitest';
import {
  implement,
  decided,
  refused,
  type ImplementReadings,
  type Write,
} from '../src/workflows/index.js';

const ready = (over: Partial<ImplementReadings> = {}): ImplementReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-08-30-a-plan.md',
  phase: 'approved',
  impl: 'own-branches',
  candidates: 1,
  drift: { found: false, what: [] },
  nextBranch: 'feature/one',
  branchExists: false,
  defaultBranch: 'main',
  startedRecords: [],
  ...over,
});

const on = { on: '2026-08-30', who: 'Jan Wloka' };
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);

describe('implement — the refusals, each without a repository', () => {
  it.each(['draft', 'design'])('refuses a plan still %s', (phase) => {
    const out = implement(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('phase-too-early');
  });

  it.each(['delivered', 'released'])('refuses a %s plan — nothing to start', (phase) => {
    const out = implement(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('phase-terminal');
  });

  it('refuses when no slug was named and several plans are ready', () => {
    const out = implement(ready({ slug: '', candidates: 3 }), on);
    expect(refused(out) && out.reason).toBe('plan-ambiguous');
  });

  it('proceeds when no slug was named and exactly one plan is ready', () => {
    expect(decided(implement(ready({ slug: '', candidates: 1 }), on))).toBe(true);
  });

  it('refuses when nothing is claimable — a normal state, not an error', () => {
    const out = implement(ready({ nextBranch: '' }), on);
    expect(refused(out) && out.reason).toBe('nothing-claimable');
    expect(refused(out) && out.detail).toContain('/plot-pulse');
  });
});

describe('implement — unattended answers "may I ask?", never "may I proceed?"', () => {
  it('stops on an unnamed plan and names the question it could not ask', () => {
    const out = implement(ready({ slug: '', candidates: 4 }), { ...on, unattended: true });
    expect(refused(out) && out.reason).toBe('plan-ambiguous');
    expect(refused(out) && out.detail).toContain('PLOT-UNASKED');
    expect(refused(out) && out.detail).toContain('no branch created');
  });

  it('stops on drift rather than picking one of the three options', () => {
    const out = implement(
      ready({ drift: { found: true, what: ['fleet.ts moved under the plan'] } }),
      { ...on, unattended: true },
    );
    expect(refused(out) && out.reason).toBe('drift-unresolved');
    expect(refused(out) && out.detail).toContain('fleet.ts moved under the plan');
  });

  it('proceeds through drift with a person present, reporting what moved', () => {
    const out = implement(ready({ drift: { found: true, what: ['one file moved'] } }), on);
    expect(decided(out) && out.detail.unasked[0]).toContain('asked');
  });
});

describe('implement — a decision names every write', () => {
  it('claims the branch, writes the brief, records Started, and commits', () => {
    const out = implement(ready(), on);
    expect(decided(out) && kinds(out.writes)).toEqual([
      'branch-create',
      'brief',
      'plan-record',
      'commit',
    ]);
  });

  it('pushes the branch — the push IS the claim and the whole lock', () => {
    const out = implement(ready(), on);
    expect(decided(out) && out.writes[0]).toEqual({
      kind: 'branch-create',
      branch: 'feature/one',
      base: 'origin/main',
      push: true,
    });
  });

  it('claims before writing the brief — claim first, work second', () => {
    const out = implement(ready(), on);
    const order = decided(out) ? kinds(out.writes) : [];
    expect(order.indexOf('branch-create')).toBeLessThan(order.indexOf('brief'));
  });

  it('flattens the branch name into the brief path', () => {
    const out = implement(ready({ nextBranch: 'feature/a/b' }), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'brief',
      file: '.plot/briefs/feature-a-b.md',
      branch: 'feature/a/b',
    });
  });

  it('records Started with the date, the starter and the branch', () => {
    const out = implement(ready(), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-08-30-a-plan.md',
      field: 'Started',
      value: '2026-08-30, Jan Wloka, `feature/one`',
    });
  });

  it('re-creates no branch that already exists — that is a resume', () => {
    const out = implement(ready({ branchExists: true, startedRecords: ['2026-08-29, X, `feature/one`'] }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('branch-create');
    expect(decided(out) && out.detail.resume).toBe(true);
  });

  it('records Started for a pre-Plot-2 branch that exists with no record', () => {
    const out = implement(ready({ branchExists: true }), on);
    expect(decided(out) && kinds(out.writes)).toEqual(['brief', 'plan-record', 'commit']);
  });

  it('writes no second Started record for a branch already recorded', () => {
    const out = implement(
      ready({ branchExists: true, startedRecords: ['2026-08-29, X, `feature/one`'] }),
      on,
    );
    expect(decided(out) && kinds(out.writes)).not.toContain('plan-record');
  });

  it('creates no branch under `same branch` — the plan already rides one', () => {
    const out = implement(ready({ impl: 'same-branch' }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('branch-create');
    expect(decided(out) && out.detail.branch).toBe('a-plan');
  });

  it('sets nothing up for a knowledge-only plan', () => {
    const out = implement(ready({ impl: 'none' }), on);
    expect(decided(out) && out.writes).toEqual([]);
    expect(decided(out) && out.detail.branch).toBe('');
  });

  it('sets no branch up for an other-repo plan — the brief is what travels', () => {
    const out = implement(ready({ impl: 'other-repo' }), on);
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('stages the plan and the brief together', () => {
    const out = implement(ready(), on);
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
      '.plot/briefs/feature-one.md',
    ]);
  });
});
