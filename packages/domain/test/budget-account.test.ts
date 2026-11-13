import { describe, expect, it } from 'vitest';

import { budgetAccountOf, hostsYmlUser, originOwner, type BudgetAccountReadings } from '../src/adapters/budget/budget-account.js';

const NONE: BudgetAccountReadings = { override: undefined, hostsYml: null, originUrl: null, jiraEmailSha256: null };
const HOSTS = 'github.com:\n    users:\n        jwloka:\n    git_protocol: ssh\n    user: jwloka\n';

describe('budgetAccountOf names the account budget_account names', () => {
  it('reads PLOT_BUDGET_ACCOUNT before hosts.yml on github', () => {
    expect(budgetAccountOf('github', { ...NONE, override: 'acme', hostsYml: HOSTS })).toBe('acme');
  });

  it('reads hosts.yml where no override is set', () => {
    expect(budgetAccountOf('github', { ...NONE, override: '', hostsYml: HOSTS })).toBe('jwloka');
  });

  it('reads unknown on github with no readable hosts.yml', () => {
    expect(budgetAccountOf('github', NONE)).toBe('unknown');
  });

  it('reads the remote owner on bitbucket', () => {
    expect(budgetAccountOf('bitbucket', { ...NONE, originUrl: 'git@bitbucket.org:quatico/plot.git' })).toBe('quatico');
  });

  it('reads unknown on bitbucket with no remote', () => {
    expect(budgetAccountOf('bitbucket', NONE)).toBe('unknown');
  });

  it('keys jira by the digest and never by the override', () => {
    expect(budgetAccountOf('jira', { ...NONE, override: 'acme', jiraEmailSha256: 'abcdef0123456789ff' })).toBe('jira:abcdef012345');
    expect(budgetAccountOf('jira', { ...NONE, override: 'acme' })).toBe('unknown');
  });

  it('reads the override on a connector it knows no source for, and unknown without one', () => {
    expect(budgetAccountOf('jenkins', { ...NONE, override: 'acme' })).toBe('acme');
    expect(budgetAccountOf('jenkins', NONE)).toBe('unknown');
  });
});

describe('the two readings budget_account parses', () => {
  it('takes the first indented user line, and an empty field where it has no value', () => {
    expect(hostsYmlUser(HOSTS)).toBe('jwloka');
    expect(hostsYmlUser('github.com:\n    user:\n    user: later\n')).toBe('');
    expect(hostsYmlUser('user: top-level\n')).toBeNull();
  });

  it('takes the owner from scp, ssh and https remotes, and keeps a URL with no owner tail', () => {
    expect(originOwner('git@bitbucket.org:ws/repo.git')).toBe('ws');
    expect(originOwner('ssh://git@altssh.bitbucket.org:443/ws/repo')).toBe('ws');
    expect(originOwner('https://bitbucket.org/ws/repo')).toBe('ws');
    expect(originOwner('https://bitbucket.org/ws/repo/')).toBe('https://bitbucket.org/ws/repo/');
  });
});
