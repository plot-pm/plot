import type { AgentRunResult } from '../ports/agent-run.js';
import type { BudgetRecord } from '../ports/budget.js';
import { rateLimitEntry } from '../rules/rate-limit-entry.js';

/** What {@link recordRunLimits} did: how many entries it wrote, and how many it could not. */
export interface RunLimitsOutcome {
  /** Entries appended. */
  written: number;
  /** Entries the record refused or failed to append. */
  failed: number;
}

/**
 * Appends one budget entry per usage-limit reading one agent run observed.
 *
 * The entry's account is the run's `account` (the connector's email, else its
 * organization), else `unknown`. A run with no readings, such as an API-key
 * account's or a `command` run's, writes nothing. A failed append is counted
 * and the next reading is still written.
 *
 * @param record - the budget record to append to.
 * @param result - what the run produced.
 * @param at - when the run ended, epoch milliseconds.
 * @returns how many entries were written and how many failed.
 */
export const recordRunLimits = async (
  record: BudgetRecord,
  result: AgentRunResult,
  at: number,
): Promise<RunLimitsOutcome> => {
  const account = result.account ?? 'unknown';
  const outcome: RunLimitsOutcome = { written: 0, failed: 0 };
  for (const reading of result.limitReadings) {
    const appended = await record.append(rateLimitEntry(reading, account, at));
    if (appended.ok) outcome.written += 1;
    else outcome.failed += 1;
  }
  return outcome;
};
