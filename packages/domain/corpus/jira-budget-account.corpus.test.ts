import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { jiraBudgetAccount } from '../src/rules/jira-budget-account.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `jiraBudgetAccount` answer what `plot-host.sh`'s `jira_budget_account`
 * answers?
 *
 * Both transports append Jira ledger lines, and `spend-rate` and the issue
 * gate match on the account, so the two must key one person the same way.
 * Each case runs the shell function with `JIRA_EMAIL` set to the recorded
 * value and asks the rule over the same text.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

const EMAILS: readonly { readonly name: string; readonly email: string }[] = [
  { name: 'an Atlassian account email', email: 'jan.wloka@example.test' },
  { name: 'a plus address', email: 'someone+jira@example.test' },
  { name: 'upper case', email: 'Someone@Example.TEST' },
  { name: 'a non-ASCII address', email: 'jürg.müller@example.test' },
  { name: 'a value with a space', email: 'a b@example.test' },
  { name: 'a value with a trailing space', email: 'someone@example.test ' },
  { name: 'a value with a dollar and a backslash', email: 'a$b\\c@example.test' },
  { name: 'the census fixture', email: 'census@census.invalid' },
  { name: 'an empty email', email: '' },
];

/** The text of `jira_budget_account`, lifted from `plot-host.sh`. */
const shellFunction = (): string => {
  const run = spawnSync('awk', ['/^jira_budget_account\\(\\) \\{/{on=1} on{print} on&&/^\\}/{on=0}', HOST], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift jira_budget_account: ${run.stderr}`);
  return run.stdout;
};

const lifted = shellFunction();

/** The shell's account for one email. */
const shellAccount = (email: string): string => {
  const run = spawnSync('bash', ['-c', `${lifted}\njira_budget_account`], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', JIRA_EMAIL: email },
  });
  if (run.error) throw new Error(`jira_budget_account did not finish: ${run.error.message}`);
  return run.stdout.replace(/\n$/, '');
};

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('jiraBudgetAccount agrees with plot-host.sh jira_budget_account', () => {
  const shell = EMAILS.map((one) => shellAccount(one.email));

  it('exercises a hashed account and the unknown account, so this is not vacuous', () => {
    expect(shell.some((account) => /^jira:[0-9a-f]{12}$/.test(account))).toBe(true);
    expect(shell).toContain('unknown');
  });

  it('answers what the shell answers on every recorded email, and no answer holds the address', () => {
    const found: Disagreement[] = [];
    EMAILS.forEach((one, i) =>
      compareField(found, one.name, 'account', jiraBudgetAccount({ email: one.email, connector: 'jira', sha256Hex }), shell[i] ?? ''),
    );
    expect(found.map(report)).toEqual([]);
    expect(shell.filter((account, i) => (EMAILS[i]?.email ?? '') !== '' && account.includes('@'))).toEqual([]);
  });
});
