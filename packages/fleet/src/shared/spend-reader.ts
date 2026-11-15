import type { LimitBasis } from '@plot-pm/domain';
import type { BudgetRecord } from '@plot-pm/domain/ports/budget';
import { readSpendRate } from '@plot-pm/domain/workflows/spend-rate';

/** The host's spend, as `plot-host.sh spend-rate` reports it. */
export interface SpendRate {
  perHour: number | null;
  resetAt: number | null;
  limit: number | null;
  basis: LimitBasis;
  account: string | null;
}

/** Reads the host's spend; null where the record gave no answer. */
export type SpendReader = () => Promise<SpendRate | null>;

/**
 * Reads the host connector's spend through the `Budget` port, in process.
 *
 * Starts no process for `github`: the record and `hosts.yml` are files. The
 * answer is the one `plot-host.sh spend-rate` gives with no `--bucket`.
 *
 * @param record - the budget record.
 * @param account - names the account a connector's lines are keyed by.
 * @param connector - names the configured git host; null where it cannot be named.
 * @param now - epoch milliseconds; `Date.now` by default.
 * @returns the reader, which answers null where the connector or the record
 *   could not be read.
 */
export const budgetSpendReader = (
  record: Pick<BudgetRecord, 'lines'>,
  account: (connector: string) => Promise<string>,
  connector: () => Promise<string | null>,
  now: () => number = Date.now,
): SpendReader => async () => {
  const name = await connector();
  if (name === null) return null;
  const answer = await readSpendRate(record, name, await account(name), now());
  if (answer === null) return null;
  return {
    perHour: answer.perHour,
    resetAt: answer.resetAt,
    limit: answer.limit,
    basis: answer.basis,
    account: answer.account === '' ? null : answer.account,
  };
};
