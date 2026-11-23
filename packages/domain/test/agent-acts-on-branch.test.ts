import { describe, expect, it } from 'vitest';
import { agentActsOnBranch } from '../src/rules/agent-acts-on-branch.js';

describe('agentActsOnBranch', () => {
  it('reads the branch where the registry recorded one', () => {
    expect(agentActsOnBranch({ branch: 'feature/a', checkout: 'feature/b' })).toBe('feature/a');
  });

  it('reads the checkout where the branch is empty', () => {
    expect(agentActsOnBranch({ branch: '', checkout: 'feature/b' })).toBe('feature/b');
  });

  it('answers null where both are empty or the checkout is absent', () => {
    expect(agentActsOnBranch({ branch: '', checkout: '' })).toBeNull();
    expect(agentActsOnBranch({ branch: '' })).toBeNull();
  });
});
