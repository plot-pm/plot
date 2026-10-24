import { describe, expect, it } from 'vitest';

import { planForBranch } from '../src/rules/plan-for-branch.js';

describe('planForBranch', () => {
  it('finds the candidate whose wave names the branch', () => {
    const candidates = [
      { file: 'docs/plans/a.md', waves: [{ name: 'Wave 1', branches: [{ branch: 'other/branch' }] }] },
      { file: 'docs/plans/b.md', waves: [{ name: 'Wave 2', branches: [{ branch: 'bug/foo' }] }] },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/b.md', waveName: 'Wave 2' });
  });

  it('returns undefined when no candidate names the branch', () => {
    const candidates = [{ file: 'docs/plans/a.md', waves: [{ name: 'Wave 1', branches: [{ branch: 'other/branch' }] }] }];
    expect(planForBranch(candidates, 'bug/foo')).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(planForBranch([], 'bug/foo')).toBeUndefined();
  });

  it('takes the first match when more than one candidate names the branch', () => {
    const candidates = [
      { file: 'docs/plans/a.md', waves: [{ name: 'Wave 1', branches: [{ branch: 'bug/foo' }] }] },
      { file: 'docs/plans/b.md', waves: [{ name: 'Wave 2', branches: [{ branch: 'bug/foo' }] }] },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/a.md', waveName: 'Wave 1' });
  });

  it('finds the branch under a later wave in the same plan', () => {
    const candidates = [
      {
        file: 'docs/plans/a.md',
        waves: [
          { name: 'Wave 1', branches: [{ branch: 'other/branch' }] },
          { name: 'Wave 2', branches: [{ branch: 'bug/foo' }] },
        ],
      },
    ];
    expect(planForBranch(candidates, 'bug/foo')).toEqual({ file: 'docs/plans/a.md', waveName: 'Wave 2' });
  });
});
