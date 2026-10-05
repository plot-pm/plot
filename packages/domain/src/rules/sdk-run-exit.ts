/**
 * Classifies one SDK run's result into the loop's existing exit vocabulary.
 *
 * `promptExit` reads a `command` runner's exit status and output text.
 * `@anthropic-ai/claude-agent-sdk` reports a structured result instead, so
 * this rule reads that shape and answers the same questions. **THE ROWS
 * APPLY IN THE PLAN'S OWN ORDER, AND THE ORDER IS THE RULE** — a usage limit
 * is read before `success`, so a run that handed back `done` while also
 * meeting a limit answers the limit rather than `ran`; an `is_error` result is
 * read before `success` is even considered, so a non-limit, non-bound error
 * never reads as a finished run.
 */
import { limitAnswer, type LimitCause, type ResetReading } from './prompt-exit.js';

/** What the caller measured about one SDK run's structured result. */
export interface SdkRunReading {
  /** Whether the spawn itself failed, or no result message arrived at all. */
  readonly noResult: boolean;
  /** The SDK's own `startup_failure_reason`, when the run never started. */
  readonly startupFailureReason: string | null;
  /** The result's `subtype`, when one arrived. */
  readonly subtype:
    | 'success'
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
    | null;
  /** How many turns this run took, as the result reports. */
  readonly numTurns: number;
  /** Whether the result carries `is_error: true`. */
  readonly isError: boolean;
  /** The result's own `terminal_reason`, when one arrived. */
  readonly terminalReason: string | null;
  /** The most recent `rate_limit_event`, when this run observed one. */
  readonly rateLimitEvent: { readonly status: string; readonly resetsAt: number } | null;
  /** Whether this run was aborted because it reached its own bound. */
  readonly abortedOnBound: boolean;
  /** Whether a `structured_output` arrived and matched the requested schema. */
  readonly structuredOutput: unknown;
  /** `Worker bound` in seconds; `0` disables the cap. */
  readonly boundSeconds: number;
  /** How long this run has taken so far, in seconds. */
  readonly ranSeconds: number;
  /** Whether this run started after a limit wait. */
  readonly afterWait: boolean;
  /** Commits the desk gained since that wait began. */
  readonly commitsSinceWait: number;
  /** Now, in epoch seconds — for resolving the rate-limit event's reset. */
  readonly now: number;
}

/** A hand-back the caller already parsed from `structuredOutput`, once it is known to match the schema. */
export type SdkHandBack =
  | { readonly next: 'checks'; readonly summary: string }
  | { readonly next: 'pushed'; readonly summary: string }
  | { readonly next: 'blocked'; readonly summary: string }
  | { readonly next: 'done'; readonly summary: string };

/** What `sdkRunExit` answers. */
export type SdkRunExit =
  | { readonly answer: 'unstarted'; readonly detail: string }
  | { readonly answer: 'wait'; readonly resetEpoch: number }
  | { readonly answer: 'end-limited'; readonly cause: LimitCause }
  | { readonly answer: 'bound' }
  | { readonly answer: 'turn-limit' }
  | { readonly answer: 'spend-limit' }
  | { readonly answer: 'ran'; readonly handBack: SdkHandBack | null; readonly detail: string };

/** The `terminal_reason` values that mean a usage limit without a `rate_limit_event`. */
const LIMIT_TERMINAL_REASONS = new Set(['blocking_limit', 'rapid_refill_breaker']);

/**
 * Parses a hand-back from a `structured_output` value, or finds it does not
 * match the `{ next, summary }` shape the worker protocol asks for.
 */
const asHandBack = (value: unknown): SdkHandBack | null => {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const next = record.next;
  const summary = typeof record.summary === 'string' ? record.summary : '';
  if (next === 'checks' || next === 'pushed' || next === 'blocked' || next === 'done') {
    return { next, summary };
  }
  return null;
};

/**
 * Classifies one SDK run's end.
 *
 * @param reading - what the caller measured about the result.
 * @returns the run's end, mapped to the loop's existing exit vocabulary.
 */
export const sdkRunExit = (reading: SdkRunReading): SdkRunExit => {
  // ROW 1 — the spawn failed, no result arrived, a startup failure was
  // reported, or an `error_during_execution` with zero turns: nothing ran.
  if (
    reading.noResult ||
    reading.startupFailureReason !== null ||
    (reading.subtype === 'error_during_execution' && reading.numTurns === 0)
  ) {
    const detail =
      reading.startupFailureReason ??
      (reading.noResult ? 'no result message arrived' : 'error_during_execution with no turns');
    return { answer: 'unstarted', detail };
  }

  // ROW 2 — a usage limit, read BEFORE success: a rejected rate-limit event
  // or the two limit-shaped terminal reasons beat a `done` hand-back, so a
  // run that met the limit while also finishing its work answers the limit.
  const rejectedEvent =
    reading.rateLimitEvent !== null && reading.rateLimitEvent.status === 'rejected'
      ? reading.rateLimitEvent
      : null;
  const limitedByTerminalReason =
    reading.terminalReason !== null && LIMIT_TERMINAL_REASONS.has(reading.terminalReason);

  if (rejectedEvent !== null || limitedByTerminalReason) {
    const resetEpoch = rejectedEvent?.resetsAt ?? reading.rateLimitEvent?.resetsAt;
    const reset: ResetReading | undefined =
      resetEpoch === undefined ? undefined : { epoch: resetEpoch, now: reading.now };
    const verdict = limitAnswer(
      reset,
      reading.boundSeconds,
      reading.ranSeconds,
      reading.afterWait,
      reading.commitsSinceWait,
    );
    return verdict.answer === 'wait'
      ? { answer: 'wait', resetEpoch: verdict.reset.epoch }
      : { answer: 'end-limited', cause: verdict.cause };
  }

  // ROW 3 — this run was aborted on its own bound.
  if (reading.abortedOnBound) {
    return { answer: 'bound' };
  }

  // ROW 4 — the turn limit.
  if (reading.subtype === 'error_max_turns' || reading.terminalReason === 'max_turns') {
    return { answer: 'turn-limit' };
  }

  // ROW 5 — the spend limit.
  if (reading.subtype === 'error_max_budget_usd' || reading.terminalReason === 'budget_exhausted') {
    return { answer: 'spend-limit' };
  }

  // ROW 6 — every other `is_error` result: a non-zero-turn run the SDK itself
  // reports failed (`api_error`, `model_error`, `prompt_too_long` and the
  // rest), never read as `ran`.
  if (reading.isError) {
    return {
      answer: 'unstarted',
      detail: reading.terminalReason ?? reading.subtype ?? 'is_error with no named reason',
    };
  }

  // ROW 7-8 — success, or a structured-output retry exhaustion: the run
  // happened. A hand-back is read only where it matches the worker
  // protocol's schema; otherwise the run is `ran` with no hand-back, and the
  // desk is read as every run is today.
  const handBack =
    reading.subtype === 'success' ? asHandBack(reading.structuredOutput) : null;
  const detail =
    handBack !== null
      ? ''
      : reading.subtype === 'error_max_structured_output_retries'
        ? 'error_max_structured_output_retries: no hand-back'
        : 'success with no structured_output';

  return { answer: 'ran', handBack, detail };
};
