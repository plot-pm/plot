import type { AgentRunLimitReading } from '../ports/agent-run.js';
import type { BudgetEntry } from '../entities/budget.js';

/**
 * Builds the budget entry one `rate_limit_event` writes.
 *
 * **A READING, NOT A CALL.** The event arrives on an SDK run already in
 * flight; it reports what the account's window looks like, and costs nothing
 * of its own — so `spent` is always `0`, never `1`. `BudgetEntry.spent` exists
 * for a connector whose calls themselves consume the budget (`gh api`, one
 * call each); this budget is consumed by the run the event rode in on, and
 * that run's own cost is recorded on its slice-spend line, not here.
 *
 * **`limit` IS ALWAYS `1` AND `remaining` CARRIES THE FRACTION LEFT.** The
 * SDK reports a *utilization*, 0 to 1 of the window, never a call count — so
 * the window is modelled as one unit and `remaining` is what fraction of it is
 * left, `1 − utilization`. A `rejected` status means the window is spent
 * regardless of what `utilization` says, so `remaining` is `0` on that path
 * unconditionally — `utilization` can under-report right at the boundary and
 * the status is the connector's own word for *no room left*.
 *
 * **`account` PRECEDENCE IS THE CALLER'S TO RESOLVE, NOT THIS RULE'S.** The
 * brief names `accountInfo().email`, then `organization`, then `'unknown'`;
 * this rule takes the resolved string as a plain parameter so it stays a pure
 * function of its readings, like every other rule here.
 *
 * **`resetAt` CONVERTS SECONDS TO MILLISECONDS.** `AgentRunLimitReading`
 * carries the SDK's `resetsAt` unconverted (epoch seconds, as the event sends
 * it); `BudgetEntry.resetAt` is epoch milliseconds, the unit every other
 * budget writer already uses. This is the one place that conversion happens —
 * see the port's own doc for why guessing the scale here was this wave's open
 * question rather than this rule's.
 *
 * @param info - one `rate_limit_event`, unconverted, from `AgentRunResult.limitReadings`.
 * @param account - the account this reading belongs to, already resolved.
 * @param at - when this run observed the event, epoch milliseconds.
 * @returns the entry {@link BudgetRecord.append} should write.
 */
export const rateLimitEntry = (
  info: AgentRunLimitReading,
  account: string,
  at: number,
): BudgetEntry => ({
  key: {
    connector: 'claude',
    account,
    bucket: info.rateLimitType === '' ? 'unknown' : info.rateLimitType,
  },
  at,
  spent: 0,
  limit: 1,
  remaining: info.status === 'rejected' ? 0 : 1 - info.utilization,
  resetAt: info.resetsAt === null ? null : info.resetsAt * 1000,
  basis: 'actual',
});
