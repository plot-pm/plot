import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetAccount } from '../src/adapters/budget/budget-account.js';

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-budget-account-'));
  mkdirSync(join(root, 'gh'));
  writeFileSync(join(root, 'gh', 'hosts.yml'), 'github.com:\n    user: octo\n');
  mkdirSync(join(root, 'home', '.config', 'gh'), { recursive: true });
  writeFileSync(join(root, 'home', '.config', 'gh', 'hosts.yml'), 'github.com:\n    user: homeuser\n');
  mkdirSync(join(root, 'repo'));
  execFileSync('git', ['init', '--quiet', join(root, 'repo')]);
  execFileSync('git', ['-C', join(root, 'repo'), 'remote', 'add', 'origin', 'git@bitbucket.org:quatico/plot.git']);
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

const bare = { PLOT_BUDGET_ACCOUNT: '', JIRA_EMAIL: '', GH_CONFIG_DIR: '' };

describe('budgetAccount reads what budget_account reads', () => {
  it('reads GH_CONFIG_DIR/hosts.yml on github', async () => {
    expect(await budgetAccount({ env: { ...bare, GH_CONFIG_DIR: join(root, 'gh') } })('github')).toBe('octo');
  });

  it('reads $HOME/.config/gh/hosts.yml where GH_CONFIG_DIR is empty', async () => {
    expect(await budgetAccount({ env: { ...bare, HOME: join(root, 'home') } })('github')).toBe('homeuser');
  });

  it('reads PLOT_BUDGET_ACCOUNT first', async () => {
    expect(await budgetAccount({ env: { ...bare, PLOT_BUDGET_ACCOUNT: 'acme', GH_CONFIG_DIR: join(root, 'gh') } })('github')).toBe('acme');
  });

  it('reads the origin owner on bitbucket', async () => {
    expect(await budgetAccount({ repoRoot: join(root, 'repo'), env: bare })('bitbucket')).toBe('quatico');
  });

  it('reads unknown on bitbucket outside a repository with an origin', async () => {
    expect(await budgetAccount({ repoRoot: root, env: { ...bare, GIT_CEILING_DIRECTORIES: root } })('bitbucket')).toBe('unknown');
  });

  it('keys jira by the email digest', async () => {
    expect(await budgetAccount({ env: { ...bare, JIRA_EMAIL: 'someone@example.com' } })('jira')).toMatch(/^jira:[0-9a-f]{12}$/);
  });
});
