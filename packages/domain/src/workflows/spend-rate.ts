import type { BudgetRecord } from '../ports/budget.js';
import { connectorSpend, type ConnectorSpend } from '../rules/budget-record.js';

/** What `plot-host.sh spend-rate` answers, read through the `Budget` port. */
export interface SpendRateAnswer extends ConnectorSpend {
  /** The connector asked about. */
  connector: string;
  /** The account its lines are keyed by. */
  account: string;
}

/**
 * Reads one connector's spend from the budget record, every bucket in one
 * window, as `plot-host.sh spend-rate` with no `--bucket` answers it. Starts
 * no process; the record adapter reads files.
 *
 * @param record - the budget record.
 * @param connector - the connector's own name, such as `github`.
 * @param account - the account its lines are keyed by.
 * @param now - epoch milliseconds.
 * @returns the answer, or null where the record cannot be read.
 */
export const readSpendRate = async (
  record: Pick<BudgetRecord, 'lines'>,
  connector: string,
  account: string,
  now: number,
): Promise<SpendRateAnswer | null> => {
  const lines = await record.lines();
  return lines.ok ? { connector, account, ...connectorSpend(lines.value, connector, account, now) } : null;
};
