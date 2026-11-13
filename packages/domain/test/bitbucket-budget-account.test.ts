import { describe, expect, it } from 'vitest';

import { bitbucketBudgetAccount } from '../src/rules/bitbucket-budget-account.js';

describe('bitbucketBudgetAccount', () => {
  it('reads the workspace from the remote forms git prints', () => {
    expect(bitbucketBudgetAccount('git@bitbucket.org:quatico/portal.git', undefined)).toBe('quatico');
    expect(bitbucketBudgetAccount('https://user@bitbucket.org/quatico/portal.git', undefined)).toBe('quatico');
    expect(bitbucketBudgetAccount('ssh://git@bitbucket.org/quatico/portal', undefined)).toBe('quatico');
  });

  it('lets a non-empty PLOT_BUDGET_ACCOUNT win, and ignores an empty one', () => {
    expect(bitbucketBudgetAccount('git@bitbucket.org:quatico/portal.git', 'census')).toBe('census');
    expect(bitbucketBudgetAccount('git@bitbucket.org:quatico/portal.git', '')).toBe('quatico');
  });

  it('answers unknown with no remote, and keeps a line that names no owner whole', () => {
    expect(bitbucketBudgetAccount(null, undefined)).toBe('unknown');
    expect(bitbucketBudgetAccount('', undefined)).toBe('unknown');
    expect(bitbucketBudgetAccount('\n', undefined)).toBe('unknown');
    expect(bitbucketBudgetAccount('portal', undefined)).toBe('portal');
    expect(bitbucketBudgetAccount('https://bitbucket.org/quatico/portal/', undefined)).toBe('https://bitbucket.org/quatico/portal/');
  });

  it('replaces every line, as sed does', () => {
    expect(bitbucketBudgetAccount('a:w1/r1\nb:w2/r2\n', undefined)).toBe('w1\nw2');
  });
});
