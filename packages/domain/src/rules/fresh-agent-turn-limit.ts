import type { EndingReason } from '../entities/ending.js';
import type { FreshAgentVerdict } from './fresh-agent.js';

/**
 * What one tick read of a desk whose worker ended `turn-limit` — or on
 * anything else, which this rule must also recognise.
 *
 * The same shape {@link FreshAgentReadings} reads for `corrections-spent`:
 * a `turn-limit` candidate reaches the registry tick through the same
 * {@link freshAgentCandidateTrees} population (unregistered, plan-named,
 * manifest gone), so `hasManifest` is always `false` here too and this rule
 * does not ask for it.
 */
export interface FreshAgentTurnLimitReadings {
  /** The desk's own ending reason, or `null` where none was written or it could not be read. */
  ending: EndingReason | null;
  /**
   * How many fresh sessions this slice already had, from `.plot/state/fresh-agents.tsv`.
   *
   * The same count {@link freshAgentAfterCorrections} reads — a slice gets one
   * fresh session in total, whichever rule asked for it first.
   */
  priorFreshSessions: number;
}

/**
 * Decides whether a `turn-limit` ending earns a desk one fresh agent
 * session, or whether that allowance has already been spent.
 *
 * **MIRRORS `freshAgentAfterCorrections`, ON A DIFFERENT ENDING.** A run
 * whose session grew too long is fixed by a short prompt, not by more of the
 * same session, so `turn-limit` gets the identical one-fresh-session-then-a-
 * person shape `corrections-spent` already has. The two rules share the
 * fresh-session count rather than keeping separate ones, because the budget
 * `a-spent-correction-budget-gets-a-fresh-agent` settled is one fresh
 * session per slice, not one per ending reason.
 *
 * Pure: it reads no disk and holds nothing between calls.
 *
 * @param readings - what the tick measured of one desk.
 * @returns what to do about it.
 */
export const freshAgentAfterTurnLimit = (
  readings: FreshAgentTurnLimitReadings,
): FreshAgentVerdict => {
  if (readings.ending !== 'turn-limit') return 'none';
  return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
};

/**
 * Composes the one fresh session's answer for a `turn-limit` ending.
 *
 * **NOT `freshAgentAnswer`, BECAUSE NOTHING WAS SPENT.** That composer's whole
 * text is about a correction budget — "the build failed... after all N
 * corrections were handed back" — and a `turn-limit` ending has no
 * corrections file and no failing run to report: `agent-loop.ts` writes its
 * detail as the fixed string `'the run reached Agent max turns'`, which
 * {@link runFromEndingDetail} parses as empty for both fields. Reusing the
 * corrections wording here would tell the fresh session a budget was spent
 * that never was.
 *
 * @param branch - the branch the slice was working.
 * @returns the answer, ready to hand to a continuation alongside its brief.
 */
export const freshAgentTurnLimitAnswer = (branch: string): string =>
  [
    `The previous session on \`${branch}\` reached Agent max turns before it finished. That is a session grown too long, not a wrong answer — pick up from what already landed, and keep this session shorter: commit progress as you go rather than holding everything until the end.`,
  ].join('\n');
