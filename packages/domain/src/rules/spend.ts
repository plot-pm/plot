import { z } from 'zod';

import type { CharterBounds } from '../entities/charter.js';

/**
 * How much of its context an agent has left.
 *
 * A VERDICT, NEVER A PERCENTAGE, and that is the whole shape of this rule.
 * {@link Headroom} is the precedent: `machine.ts` reads a spawn cost and
 * reports `clear`/`tight`/`starved` rather than milliseconds, because a
 * threshold in a value is a threshold every consumer owns. A domain exposing
 * `0.64` would put the ceiling in the board, in the monitor, in the dispatcher
 * and in whatever reads it next, and the four would drift.
 *
 * - `ample` — the agent is below its ceiling and may take another slice.
 * - `spent` — the agent is at or past its ceiling. **Nothing is wrong with
 *   it**; it should simply not be handed a next slice. This is a reason and
 *   not a dispatch filter, so an operator can tell *this agent is done* from
 *   *no work is available*.
 * - `unknown` — nothing could be read. A missing transcript, an unattributable
 *   one, a window nobody stated.
 *
 * **`unknown` IS NOT `ample`.** Silence is not headroom. An `unknown` read as
 * `ample` would hand a slice to an agent whose context nobody measured, which
 * is the direction that cannot be repaired — the same rule
 * `plot-worker-state.sh` applies to an unreadable worktree, and the one
 * `hasRoomToDispatch` applies to `unmeasured`.
 */
export const ContextVerdictSchema = z.enum(['ample', 'spent', 'unknown']);
export type ContextVerdict = z.infer<typeof ContextVerdictSchema>;

/**
 * What was measured of ONE agent's context.
 *
 * **EVERY FIELD IS A READING**, and both come from the same transcript line —
 * the newest non-sidechain assistant turn of the session the agent was
 * dispatched under.
 *
 * **READ PER SESSION, NEVER PER WORKTREE.** Quiet-detection deliberately takes
 * the newest line across ALL of a worktree's sessions, which is right for *is
 * anything happening at this desk* and wrong for *what has this agent spent*:
 * one project directory measured 2026-09-03 held 45 session files, 30 of them
 * subagents, and a sum across them belongs to no one. Same file, opposite
 * joins — which is why `feature/a-worker-names-its-session` came first, and why
 * a caller that cannot name the session must pass `null` here rather than
 * reach for the newest file.
 */
export interface ContextReadings {
  /**
   * Tokens the agent's newest turn carried as context, or null when unread.
   *
   * `cache_read_input_tokens` plus whatever the turn added, as
   * {@link contextTokensFromUsage} sums it. Null is how a caller says the
   * transcript was missing, the session unattributable, or the line
   * unrecognised — never zero, which is a real reading meaning a turn that
   * carried nothing.
   */
  contextTokens: number | null;
}

/**
 * The `usage` fields a turn's context is summed from.
 *
 * **THREE FIELDS, AND THE CACHE ONES ARE THE BULK.** Measured 2026-09-03 on a
 * real session: `cache_read_input_tokens` alone was 642,532, and with
 * `input_tokens` and `cache_creation_input_tokens` the turn carried 643,808 —
 * 64.4% of a 1M window. A sum of the read alone would under-report by whatever
 * the turn just added, which is exactly the part that grows as an agent
 * approaches its ceiling.
 *
 * `output_tokens` IS DELIBERATELY ABSENT. It is what the turn produced, not
 * what it carried in; counting it would charge the agent twice for text that
 * arrives as input on the next turn anyway.
 */
export const CONTEXT_USAGE_FIELDS: readonly string[] = [
  'input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
];

/**
 * Sums a transcript turn's `usage` object into a context reading.
 *
 * Takes the parsed object rather than a path or a line: the domain does not
 * touch the disk, so the caller decides what it read and this decides what it
 * means. `null` is how a caller says there was no transcript, no attributable
 * session, or no line it recognised.
 *
 * **A `usage` CARRYING NONE OF THE THREE FIELDS ANSWERS `null`, NOT `0`.** The
 * transcript is the runtime's private format and may rename a field between
 * releases; a zero would report an agent with a full window as having spent
 * nothing, and {@link contextVerdict} would call it `ample`. A null becomes
 * `unknown`, which is the answer that gets looked at.
 *
 * A field present but not a finite number contributes nothing and does not
 * poison the sum — a `NaN` reaching a verdict is a guess wearing a number's
 * clothes, the same reason the board's reader tests `Number.isFinite`.
 *
 * @param usage - the turn's parsed `usage` object, or null when unread.
 * @returns the summed tokens, or null when nothing recognisable was found.
 */
export const contextTokensFromUsage = (usage: unknown): number | null => {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  let total = 0;
  let found = false;
  for (const field of CONTEXT_USAGE_FIELDS) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    total += value;
    found = true;
  }
  return found ? total : null;
};

/**
 * Reads what an agent has spent as a context verdict.
 *
 * **THE READING IS MEASURED AND THE BOUNDS ARE DECLARED**, and the split is the
 * rule. The transcript supplies the numerator and nothing supplies the
 * denominator: measured 2026-09-04, a turn carries four token counts and the
 * model's name, and no key in the file matches `window` or `limit`. So the
 * window comes from the charter — a fact a person wrote — and an agent whose
 * charter states none answers `unknown` rather than being judged against a
 * number nobody chose.
 *
 * **THAT IS THE ESTATE TODAY**, where nothing is declared. Every existing
 * worker reads `unknown`, is handed no work on that basis and is ended on no
 * basis either, so this rule changes nothing until a charter names a window.
 *
 * **THE COMPARISON IS `>=`.** A ceiling of `1` on a full window must answer
 * `spent`; `>` would leave an agent with nothing left reading `ample` at
 * exactly the reading the ceiling exists to catch.
 *
 * A non-finite or negative reading, and a window or ceiling that is not a
 * positive number, each answer `unknown` rather than throwing. The transcript
 * is the runtime's private format and may move a field between releases; a rule
 * that threw on that would cost the pulse that read it.
 *
 * @param readings - what was measured of this agent's context.
 * @param bounds - what the agent's charter says it may spend, and against what
 *   window.
 * @returns `unknown` when the reading or either bound is absent or unusable,
 *   `spent` at or past the ceiling, otherwise `ample`.
 */
export const contextVerdict = (
  readings: ContextReadings,
  bounds: Pick<CharterBounds, 'contextCeiling' | 'contextWindow'>,
): ContextVerdict => {
  const { contextTokens } = readings;
  const { contextCeiling: ceiling, contextWindow: window } = bounds;
  if (contextTokens === null || !Number.isFinite(contextTokens) || contextTokens < 0) {
    return 'unknown';
  }
  if (!Number.isFinite(window) || window <= 0) return 'unknown';
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 'unknown';
  return contextTokens / window >= ceiling ? 'spent' : 'ample';
};

/**
 * Whether an agent should be handed another slice.
 *
 * NOT the negation of `spent`, and the difference is the rule. `unknown`
 * answers false here — a reading nobody took is not permission — while
 * {@link agentIsSpent} answers false for it too, because *cannot answer* is not
 * *yes* in either direction. An agent whose context cannot be read is neither
 * given work nor declared finished; it is reported, and a person decides.
 *
 * The asymmetry is `hasRoomToDispatch`/`dispatchDefers`, applied to context.
 *
 * @param verdict - the context verdict.
 * @returns true only for `ample`.
 */
export const hasContextForAnotherSlice = (verdict: ContextVerdict): boolean => verdict === 'ample';

/**
 * Whether an agent has reached its context ceiling.
 *
 * `unknown` answers false: an unmeasured agent has not been shown to be spent,
 * and ending it on silence would end every agent whose transcript the runtime
 * moved.
 *
 * @param verdict - the context verdict.
 * @returns true only for `spent`.
 */
export const agentIsSpent = (verdict: ContextVerdict): boolean => verdict === 'spent';
