import { describe, expect, it } from 'vitest';

import { budgetFixture } from '@plot-pm/domain/adapters/budget/budget-fixture';
import { failed } from '@plot-pm/domain';

import { budgetSpendReader } from '../../src/shared/spend-reader.js';
import { spendForTick } from '../../src/server/entry/registryd-main.js';

const NOW = 1_788_269_670_000;
const line = (account: string, at: number): string => `b1\tgithub\t${account}\tcore\t${at}\t1\t5000\t4990\t${NOW + 600_000}\tactual`;

describe('budgetSpendReader reads the spend through the Budget port', () => {
  it('answers the rate, the reading and the account of the configured connector', async () => {
    const asked: string[] = [];
    const reader = budgetSpendReader(
      budgetFixture({ lines: [line('acme', NOW - 120_000), line('someone', NOW - 60_000)] }),
      async (connector) => {
        asked.push(connector);
        return 'acme';
      },
      async () => 'github',
      () => NOW,
    );
    expect(await reader()).toEqual({ perHour: 30, resetAt: NOW + 600_000, limit: 5000, basis: 'actual', account: 'acme' });
    expect(asked).toEqual(['github']);
  });

  it('answers null where no connector is named or the record cannot be read', async () => {
    expect(await budgetSpendReader(budgetFixture(), async () => 'acme', async () => null)()).toBeNull();
    expect(await budgetSpendReader({ lines: async () => failed() }, async () => 'acme', async () => 'github')()).toBeNull();
  });

  it('reads an empty account as none', async () => {
    expect(await budgetSpendReader(budgetFixture(), async () => '', async () => 'github', () => NOW)()).toMatchObject({ account: null, perHour: null });
  });
});

describe('the tick line reads the account rate through the reader it is given', () => {
  it('asks the reader and starts no plot-host.sh', async () => {
    const asked: string[][] = [];
    const scripts = { hostSaid: async (args: readonly string[]) => { asked.push([...args]); return { answer: 'failed' as const, said: 'unused' }; } };
    const spend = await spendForTick(scripts, [], async () => ({ perHour: 42, resetAt: null, limit: null, basis: 'unknown', account: 'acme' }));
    expect(spend.accountPerHour).toBe(42);
    expect(asked).toEqual([]);
  });

  it('reads a reader that answers null as no evidence', async () => {
    const scripts = { hostSaid: async () => ({ answer: 'failed' as const, said: 'unused' }) };
    expect((await spendForTick(scripts, [], async () => null)).accountPerHour).toBeNull();
  });
});
