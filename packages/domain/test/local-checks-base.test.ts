import { describe, it, expect } from 'vitest';
import { localChecksBase } from '../src/rules/local-checks-base.js';

const held = ['main', 'sprint/nothing-runs'];

describe('localChecksBase', () => {
  it('takes the --base argument first, even over a sprint', () => {
    expect(localChecksBase({ flag: 'main', sprint: 'nothing-runs', remoteBranches: held })).toBe('main');
  });

  it('takes the sprint branch when the plan names a sprint and origin holds the branch', () => {
    expect(localChecksBase({ flag: null, sprint: 'nothing-runs', remoteBranches: held })).toBe('sprint/nothing-runs');
  });

  it('falls back to the default branch when origin lacks the sprint branch', () => {
    expect(localChecksBase({ flag: null, sprint: 'other', remoteBranches: held })).toBeUndefined();
  });

  it('falls back to the default branch with no sprint, an empty sprint or an empty flag', () => {
    expect(localChecksBase({ flag: null, sprint: null, remoteBranches: held })).toBeUndefined();
    expect(localChecksBase({ flag: ' ', sprint: ' ', remoteBranches: held })).toBeUndefined();
  });
});
