import { describe, expect, it } from 'vitest';

import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { emptySnapshot, type Readings, type RepoSnapshot } from '../src/entities/snapshot.js';
import { boardInputsFrom } from '../src/workflows/board-inputs.js';

const AT = 1_700_000_000_000;
const MAIN = 'a'.repeat(40);

const served = (over: Partial<Readings> = {}, plans: Partial<Extract<Readings['plans'], { state: 'read' }>['value']> = {}): RepoSnapshot => ({
  generation: 4,
  readings: {
    ...emptySnapshot().readings,
    refs: { state: 'read', readAt: AT, value: { entries: [{ ref: 'refs/remotes/origin/main', sha: MAIN }], digest: 'd' } },
    plans: {
      state: 'read',
      readAt: AT,
      value: {
        ref: 'origin/main',
        resolved: MAIN,
        records: [
          planRecord({ file: 'docs/plans/a.md' }),
          { ...planRecord({ file: 'docs/plans/bad.md' }), error: 'no Status' },
          planRecord({ file: 'docs/plans/x.md' }),
        ],
        authors: { state: 'read', value: { 'docs/plans/a.md': 'Ann' } },
        delivered: { state: 'read', value: { 'docs/plans/a.md': { claimLines: ['- [x] c'], deliveryCommit: 'c1' } } },
        ...plans,
      },
    },
    branchPlans: {
      state: 'read',
      readAt: AT,
      value: [
        { branch: 'feature/x', path: 'docs/plans/x.md', record: planRecord({ file: 'docs/plans/x.md' }) },
        { branch: 'idea/y', path: 'docs/plans/y.md', record: { ...planRecord({ file: 'docs/plans/y.md' }), error: 'bad' } },
      ],
    },
    sprints: { state: 'read', readAt: AT, value: [] },
    stories: { state: 'read', readAt: AT, value: { live: [], archived: [] } },
    ...over,
  },
});

describe('boardInputsFrom', () => {
  it('answers the inputs of a snapshot whose readings are read, without the files the parser could not read or a branch holds', () => {
    const answer = boardInputsFrom(served());
    expect('inputs' in answer).toBe(true);
    if (!('inputs' in answer)) return;
    expect(answer.inputs.defaultBranch).toBe('main');
    expect(answer.inputs.planRef).toBe('origin/main');
    expect(answer.inputs.resolved).toBe(MAIN);
    expect(answer.inputs.plans.map((p) => p.file)).toEqual(['docs/plans/a.md']);
    expect(answer.inputs.branchPlans.map((p) => p.path)).toEqual(['docs/plans/x.md']);
    expect(answer.inputs.authors).toEqual({ 'docs/plans/a.md': 'Ann' });
    expect(Object.keys(answer.inputs.delivered)).toEqual(['docs/plans/a.md']);
    expect(answer.inputs.refs).toHaveLength(1);
  });

  it.each([
    ['refs', { refs: { state: 'unread' } }],
    ['plans', { plans: { state: 'failed', readAt: AT, reason: 'r' } }],
    ['branchPlans', { branchPlans: { state: 'unread' } }],
    ['sprints', { sprints: { state: 'failed', readAt: AT, reason: 'r' } }],
    ['stories', { stories: { state: 'unread' } }],
  ] as const)('names %s where that reading is not read', (key, over) => {
    expect(boardInputsFrom(served(over as Partial<Readings>))).toEqual({ unknown: key });
  });

  it('names plans.ref where the plans were read from the checkout', () => {
    expect(boardInputsFrom(served({}, { ref: 'worktree', resolved: '' }))).toEqual({ unknown: 'plans.ref' });
    expect(boardInputsFrom(served({}, { resolved: '' }))).toEqual({ unknown: 'plans.ref' });
  });

  it('names plans.authors and plans.delivered where that answer failed', () => {
    expect(boardInputsFrom(served({}, { authors: { state: 'failed', reason: 'r' } }))).toEqual({ unknown: 'plans.authors' });
    expect(boardInputsFrom(served({}, { delivered: { state: 'failed', reason: 'r' } }))).toEqual({ unknown: 'plans.delivered' });
  });
});
