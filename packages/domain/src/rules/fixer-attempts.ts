import type { FixerAttemptsRecord } from '../entities/fixer-attempts.js';

/** How many fixer attempts a PR may spend before the HIGH goes to a ticket instead. */
export const FIXER_ATTEMPTS_BUDGET = 2;

/**
 * How many attempts a PR has spent, for the budget check.
 *
 * **A MISSING OR UNREADABLE RECORD READS AS ZERO.** Zero is the SAFE
 * direction for a budget: reading "no record" as "budget exhausted" would
 * refuse every fixer forever on a filesystem hiccup, while reading it as zero
 * costs at most one extra attempt before the record exists to say otherwise.
 * This is the opposite direction from {@link fixerInFlight}, deliberately —
 * see that function's own contract for why the two must not share a reading.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'` from
 *   {@link decodeFixerAttempts}.
 * @returns the number of attempts spent; `0` where there is nothing to count.
 */
export const fixerAttemptsSpent = (record: FixerAttemptsRecord | 'none' | 'unreadable'): number =>
  record === 'none' || record === 'unreadable' ? 0 : record.attempts.length;

/**
 * Whether a PR has spent its whole fixer budget.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @returns true once {@link fixerAttemptsSpent} reaches {@link FIXER_ATTEMPTS_BUDGET}.
 */
export const fixerAttemptsExhausted = (record: FixerAttemptsRecord | 'none' | 'unreadable'): boolean =>
  fixerAttemptsSpent(record) >= FIXER_ATTEMPTS_BUDGET;

/**
 * Whether a fixer is currently running on this PR, for the "no second fixer"
 * check.
 *
 * **AN UNREADABLE RECORD HOLDS.** This is the opposite default from
 * {@link fixerAttemptsSpent}, and the plan states why: reading an unreadable
 * in-flight mark as "nothing is running" is exactly what starts the second
 * fixer this record exists to prevent. A missing record (`'none'`) is not the
 * same fact — no record at all means no attempt was ever written, which is a
 * genuine "nothing running" rather than a mark this build could not parse —
 * so only `'none'` answers false here; `'unreadable'` answers true, the hold.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @returns true where a fixer should be treated as in flight — including the
 *   unreadable case, which holds rather than starting a second one.
 */
export const fixerInFlight = (record: FixerAttemptsRecord | 'none' | 'unreadable'): boolean => {
  if (record === 'none') return false;
  if (record === 'unreadable') return true;
  return record.attempts.some((attempt) => attempt.inFlight !== undefined);
};
