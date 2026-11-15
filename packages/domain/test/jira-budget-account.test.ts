import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { jiraBudgetAccount, UNKNOWN_BUDGET_ACCOUNT } from '../src/rules/jira-budget-account.js';

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('jiraBudgetAccount', () => {
  it('answers the connector word and the first 12 hex digits of the SHA-256 of the email', () => {
    const account = jiraBudgetAccount({ email: 'someone@example.test', connector: 'tracker', sha256Hex });

    expect(account).toBe(`tracker:${sha256Hex('someone@example.test').slice(0, 12)}`);
    expect(account).not.toContain('someone');
  });

  it('answers unknown for an empty email, and asks the hasher nothing', () => {
    let asked = 0;
    const counting = (text: string): string => {
      asked += 1;
      return sha256Hex(text);
    };

    expect(jiraBudgetAccount({ email: '', connector: 'tracker', sha256Hex: counting })).toBe(UNKNOWN_BUDGET_ACCOUNT);
    expect(asked).toBe(0);
  });

  it('answers unknown, never the email, where the hasher answers nothing', () => {
    expect(jiraBudgetAccount({ email: 'a@b.test', connector: 'tracker', sha256Hex: () => null })).toBe('unknown');
    expect(jiraBudgetAccount({ email: 'a@b.test', connector: 'tracker', sha256Hex: () => '' })).toBe('unknown');
  });
});
