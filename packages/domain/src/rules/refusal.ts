import { boardSharePerHour } from './cadence.js';
import type { SpendRate } from './budget-record.js';

/**
 * Which limit a host refusal hit.
 *
 * `quota`      the window's requests are spent. It recovers at the reset, which
 *              the response carries, and the honest reaction is to stop until
 *              then and say when.
 * `secondary`  too many requests at once. It recovers in seconds, carries no
 *              reset, and the reaction is to retry shortly and lower
 *              concurrency.
 * `outage`     anything else. A refusal that names no limit is not one.
 *
 * THE TWO LIMITS ARE DIFFERENT CEILINGS, and the repo has measured both.
 * 2026-08-27: eight workers against a cap of seven produced a 403 naming abuse
 * detection. 2026-09-01: `gh pr view` refused with *"API rate limit already
 * exceeded"* while the same account's GraphQL headers read 4854 of 5000
 * remaining. A bucket with 97 % left does not refuse on quota, so the two causes
 * are real and separate.
 *
 * THE SPLIT FALLS ONE WAY ONLY, the same direction `host_failure_kind` refuses
 * to guess in: an unrecognised message is `outage`, never the more specific
 * name, because a wrong reaction to a refusal is worse than no reaction.
 */
export type RefusalKind = 'quota' | 'secondary' | 'outage';

/**
 * The wordings a secondary limit announces itself by.
 *
 * READ IN FULL BEFORE THE QUOTA WORDING, because GitHub's secondary message
 * contains the phrase *"rate limit"* too — *"You have exceeded a secondary rate
 * limit"* — so a quota test applied first claims every secondary refusal. The
 * order of the two tests is the whole classification.
 */
const SECONDARY_PATTERNS = [
  /secondary rate/i,
  /exceeded a secondary/i,
  /abuse detection/i,
  /abuse-detection/i,
  /too many requests/i,
  /\b429\b/,
] as const;

/** The wordings a spent window announces itself by. */
const QUOTA_PATTERNS = [/rate limit/i, /ratelimit/i] as const;

/**
 * Classifies a host's refusal by the message it refused with.
 *
 * READ OFF THE WORDING, because that is all a shelled-out `gh` or `bb` hands
 * back. The exit code cannot split these cases — `gh` exits 1 for a spent quota,
 * a secondary limit and a 503 alike — and this slice deliberately does not parse
 * response headers, which is `bug/the-budget-knows-which-bucket-it-spent`.
 *
 * @param message - the host CLI's stderr, or null where nothing failed.
 * @returns which limit was hit, or null where there was no refusal to classify.
 */
export const refusalKind = (message: string | null): RefusalKind | null => {
  if (!message) return null;
  if (SECONDARY_PATTERNS.some((pattern) => pattern.test(message))) return 'secondary';
  if (QUOTA_PATTERNS.some((pattern) => pattern.test(message))) return 'quota';
  return 'outage';
};

/**
 * Whether a reset time may be printed for this refusal.
 *
 * ONLY A SPENT QUOTA HAS ONE. A secondary limit clears in seconds and the
 * primary reset beside it is a number about a different ceiling — printing it
 * counsels a wait of minutes for a limit that has already cleared, which is the
 * opposite of what helps. An outage has no reset at all.
 *
 * @param kind - which limit was hit.
 * @returns true where the reset describes the limit that actually refused.
 */
export const resetApplies = (kind: RefusalKind | null): boolean => kind === 'quota';

/**
 * How many spenders the record accounts for, or null where it cannot say.
 *
 * FROM THE RECORD, NEVER A HEADCOUNT. The spenders are eleven scripts, the
 * board, and a person at a terminal, so a count of board processes misses the
 * scripts and a count of processes misses the person. What the record holds is
 * the rate the whole account is observed spending, and one spender's share is
 * exactly what `boardSharePerHour` already derives for the cadence — so the
 * count is the quotient, and the two numbers cannot drift apart.
 *
 * ROUNDED, AND FLOORED AT ONE. A refusal is itself evidence that something
 * spent, so an observed rate below one share still means one spender rather than
 * none. A null rate is an absent measurement and stays null: the banner then
 * names the limit without inventing a population.
 *
 * @param rate - what the record says about this account, or null.
 * @param intervalMs - the unstretched interval, which sets one spender's share.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns the spenders the observed rate accounts for, or null.
 */
export const localSpenders = (
  rate: Pick<SpendRate, 'perHour'> | null,
  intervalMs: number,
  costPerRefresh: number,
): number | null => {
  const perHour = rate?.perHour ?? null;
  if (perHour === null || !Number.isFinite(perHour) || perHour <= 0) return null;
  const share = boardSharePerHour(intervalMs * costPerRefresh, costPerRefresh);
  if (!Number.isFinite(share) || share <= 0) return null;
  return Math.max(1, Math.round(perHour / share));
};

/**
 * What the banner must say about one refusal — the decision, not the sentence.
 *
 * EVERY RENDERED STATE IS A DOMAIN PROPERTY. The choice of which wording the
 * banner uses is a decision about a reading, so it is made here and
 * `host-notes.ts` reads the answer; a choice made in a component can only be
 * tested by rendering it.
 *
 * The words themselves stay in the board, where the reader's contract lives.
 * This says which limit was hit, whether the reset describes it, and how many
 * spenders the record found.
 */
export interface RefusalReport {
  /** Which limit was hit. */
  kind: RefusalKind;
  /** Whether a reset time may be printed for this refusal. */
  showsReset: boolean;
  /** The spenders the record accounts for, or null where it cannot say. */
  spenders: number | null;
}

/**
 * Reads one refusal into the facts the banner needs.
 *
 * THE SPENDER COUNT IS CARRIED ONLY WHERE IT EXPLAINS SOMETHING. A secondary
 * limit is local contention — the fix is closing a board rather than waiting for
 * GitHub — so the count belongs to that case. A spent quota is an account-level
 * ceiling that one spender can reach alone, and naming a population there would
 * point the reader at the wrong lever.
 *
 * @param message - the host CLI's stderr, or null where nothing failed.
 * @param rate - what the record says about this account, or null.
 * @param intervalMs - the unstretched interval, which sets one spender's share.
 * @param costPerRefresh - what one refresh costs in host requests.
 * @returns the report, or null where there was no refusal.
 */
export const refusalReport = (
  message: string | null,
  rate: Pick<SpendRate, 'perHour'> | null,
  intervalMs: number,
  costPerRefresh: number,
): RefusalReport | null => {
  const kind = refusalKind(message);
  if (kind === null) return null;
  return {
    kind,
    showsReset: resetApplies(kind),
    spenders: kind === 'secondary' ? localSpenders(rate, intervalMs, costPerRefresh) : null,
  };
};
