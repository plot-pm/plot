/**
 * Classifies one SDK run's result into the loop's existing exit vocabulary.
 *
 * `promptExit` reads a `command` runner's exit status and output text.
 * `@anthropic-ai/claude-agent-sdk` reports a structured result instead, so
 * this rule reads that shape and answers the same questions.
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
  /**
   * The most recent `rate_limit_event`, when this run observed one.
   * `resetsAt` is in epoch seconds, as the SDK sends it; `null` where the
   * event names no reset.
   */
  readonly rateLimitEvent: { readonly status: string; readonly resetsAt: number | null } | null;
  /** Whether this run was aborted because it reached its own bound. */
  readonly abortedOnBound: boolean;
  /** The result's `structured_output`, or `undefined` where none arrived. */
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

/** A board role's hand-back, once `structuredOutput` is known to match its own schema. */
export type SdkBoardHandBack =
  | { readonly written: string; readonly summary: string }
  | { readonly outcome: 'done' | 'refused'; readonly summary: string };

/** What `sdkRunExit` answers. */
export type SdkRunExit =
  | { readonly answer: 'unstarted'; readonly detail: string }
  /** A usage limit the loop may wait out; `resetEpoch` is the reset in epoch seconds. */
  | { readonly answer: 'wait'; readonly resetEpoch: number }
  | { readonly answer: 'end-limited'; readonly cause: LimitCause }
  | { readonly answer: 'bound' }
  | { readonly answer: 'turn-limit' }
  | { readonly answer: 'spend-limit' }
  | {
      readonly answer: 'ran';
      readonly handBack: SdkHandBack | SdkBoardHandBack | null;
      readonly detail: string;
    };

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
 * Parses a board role's hand-back from a `structured_output` value: either
 * `{ written, summary }` or `{ outcome, summary }`, whichever the value
 * matches; `null` where it matches neither.
 */
export const asBoardHandBack = (value: unknown): SdkBoardHandBack | null => {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary : '';
  if (typeof record.written === 'string' && record.written !== '') return { written: record.written, summary };
  if (record.outcome === 'done' || record.outcome === 'refused') return { outcome: record.outcome, summary };
  return null;
};

/**
 * Classifies one SDK run's end.
 *
 * Rows apply in this order: a bound abort; a usage limit (a rejected
 * `rate_limit_event`, or a limit-shaped `terminal_reason`); an unstarted run
 * (no result, a startup failure, or a zero-turn `error_during_execution`);
 * the turn limit; the spend limit; `error_max_structured_output_retries`;
 * any other `is_error` result; and `success`.
 *
 * @param reading - what the caller measured about the result.
 * @param parseHandBack - parses `reading.structuredOutput` on success; the
 *   worker's `{ next, summary }` parser by default, so a caller naming none
 *   sees today's behaviour unchanged. A board role passes {@link asBoardHandBack}.
 * @returns the run's end, mapped to the loop's existing exit vocabulary.
 */
export const sdkRunExit = (
  reading: SdkRunReading,
  parseHandBack: (value: unknown) => SdkHandBack | SdkBoardHandBack | null = asHandBack,
): SdkRunExit => {
  // ROW 1 — this run was aborted on its own bound, whether or not a result
  // message arrived.
  if (reading.abortedOnBound) {
    return { answer: 'bound' };
  }

  // ROW 2 — a usage limit. A run that met a limit answers the limit, even
  // where it also handed back `done` or took no turn.
  const rejectedEvent =
    reading.rateLimitEvent !== null && reading.rateLimitEvent.status === 'rejected'
      ? reading.rateLimitEvent
      : null;
  const limitedByTerminalReason =
    reading.terminalReason !== null && LIMIT_TERMINAL_REASONS.has(reading.terminalReason);

  if (rejectedEvent !== null || limitedByTerminalReason) {
    const resetEpoch = reading.rateLimitEvent?.resetsAt ?? null;
    const reset: ResetReading | undefined =
      resetEpoch === null ? undefined : { epoch: resetEpoch, now: reading.now };
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

  // ROW 3 — nothing ran.
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

  // ROW 4 — the turn limit.
  if (reading.subtype === 'error_max_turns' || reading.terminalReason === 'max_turns') {
    return { answer: 'turn-limit' };
  }

  // ROW 5 — the spend limit.
  if (reading.subtype === 'error_max_budget_usd' || reading.terminalReason === 'budget_exhausted') {
    return { answer: 'spend-limit' };
  }

  // ROW 6 — the structured output never matched the schema: the run happened
  // and carries no hand-back. The SDK sets `is_error` on this subtype, so it
  // is read before the `is_error` row.
  if (reading.subtype === 'error_max_structured_output_retries') {
    return { answer: 'ran', handBack: null, detail: 'error_max_structured_output_retries: no hand-back' };
  }

  // ROW 7 — every other `is_error` result.
  if (reading.isError) {
    return {
      answer: 'unstarted',
      detail: reading.terminalReason ?? reading.subtype ?? 'is_error with no named reason',
    };
  }

  // ROW 8 — success: a hand-back where `structured_output` matches the
  // schema, else `ran` with no hand-back.
  const handBack = reading.subtype === 'success' ? parseHandBack(reading.structuredOutput) : null;
  return { answer: 'ran', handBack, detail: handBack === null ? 'success with no structured_output' : '' };
};
