import { describe, expect, it } from 'vitest';

import { planForBranch, plansMentioning } from '../src/rules/plan-for-branch.js';

describe('plansMentioning', () => {
  it('keeps only the plans whose text contains the branch name', () => {
    const plans = [
      { file: 'docs/plans/a.md', text: '- `other/branch` — x\n' },
      { file: 'docs/plans/b.md', text: '- `bug/foo` — y\n' },
    ];
    expect(plansMentioning(plans, 'bug/foo')).toEqual(['docs/plans/b.md']);
  });

  it('matches the name literally, so a regex metacharacter in it matches only itself', () => {
    const plans = [
      { file: 'docs/plans/a.md', text: '- `bug/fooXbar` — x\n' },
      { file: 'docs/plans/b.md', text: '- `bug/foo.bar` — y\n' },
    ];
    expect(plansMentioning(plans, 'bug/foo.bar')).toEqual(['docs/plans/b.md']);
  });
});

describe('planForBranch', () => {
  it('finds the candidate whose slice names the branch', () => {
    const candidates = [
      { file: 'docs/plans/a.md', slices: [{ name: 'Slice 1', branches: [{ branch: 'other/branch' }] }] },
      { file: 'docs/plans/b.md', slices: [{ name: 'Slice 2', branches: [{ branch: 'bug/foo' }] }] },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/b.md', sliceName: 'Slice 2' });
  });

  it('returns undefined when no candidate names the branch', () => {
    const candidates = [{ file: 'docs/plans/a.md', slices: [{ name: 'Slice 1', branches: [{ branch: 'other/branch' }] }] }];
    expect(planForBranch(candidates, 'bug/foo')).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(planForBranch([], 'bug/foo')).toBeUndefined();
  });

  it('takes the first match when more than one candidate names the branch', () => {
    const candidates = [
      { file: 'docs/plans/a.md', slices: [{ name: 'Slice 1', branches: [{ branch: 'bug/foo' }] }] },
      { file: 'docs/plans/b.md', slices: [{ name: 'Slice 2', branches: [{ branch: 'bug/foo' }] }] },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/a.md', sliceName: 'Slice 1' });
  });

  it('finds the branch under a later slice in the same plan', () => {
    const candidates = [
      {
        file: 'docs/plans/a.md',
        slices: [
          { name: 'Slice 1', branches: [{ branch: 'other/branch' }] },
          { name: 'Slice 2', branches: [{ branch: 'bug/foo' }] },
        ],
      },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/a.md', sliceName: 'Slice 2' });
  });
});
