import { describe, expect, it } from 'vitest';

import { budgetFixture } from '../src/adapters/budget/budget-fixture.js';
import { failed } from '../src/port-result.js';
import { readSpendRate } from '../src/workflows/spend-rate.js';

const NOW = 1_788_269_670_000;
const line = (at: number): string => `b1\tgithub\tjwloka\tcore\t${at}\t1\t5000\t4990\t-\tactual`;

describe('readSpendRate reads the record through the Budget port', () => {
  it('answers the connector, the account and the spend over the window', async () => {
    const answer = await readSpendRate(budgetFixture({ lines: [line(NOW - 60_000)] }), 'github', 'jwloka', NOW);
    expect(answer).toEqual({
      connector: 'github',
      account: 'jwloka',
      spent: 1,
      spanMs: 60_000,
      perHour: 60,
      limit: 5000,
      remaining: 4990,
      resetAt: null,
      basis: 'actual',
    });
  });

  it('answers null where the record cannot be read', async () => {
    expect(await readSpendRate({ lines: async () => failed() }, 'github', 'jwloka', NOW)).toBeNull();
  });
});
