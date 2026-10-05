import { describe, expect, it } from 'vitest';
import { sdkRunExit, type SdkRunReading } from '../src/rules/sdk-run-exit.js';

const NOW = 1790863200;

const base = (over: Partial<SdkRunReading> = {}): SdkRunReading => ({
  noResult: false,
  startupFailureReason: null,
  subtype: 'success',
  numTurns: 5,
  isError: false,
  terminalReason: null,
  rateLimitEvent: null,
  abortedOnBound: false,
  structuredOutput: { next: 'done', summary: 'finished' },
  boundSeconds: 28800,
  ranSeconds: 10,
  afterWait: false,
  commitsSinceWait: 0,
  now: NOW,
  ...over,
});

describe('sdkRunExit', () => {
  it('answers the limit for a rejected rate_limit_event even with a done hand-back', () => {
    const result = sdkRunExit(
      base({
        rateLimitEvent: { status: 'rejected', resetsAt: NOW + 4800 },
      }),
    );
    expect(result.answer).not.toBe('ran');
    expect(['wait', 'end-limited']).toContain(result.answer);
  });

  it('answers unstarted for a zero-turn error_during_execution, not a limit', () => {
    const result = sdkRunExit(
      base({ subtype: 'error_during_execution', numTurns: 0, structuredOutput: null }),
    );
    expect(result.answer).toBe('unstarted');
  });

  it('answers ran with the hand-back on success with a matching structured_output', () => {
    const result = sdkRunExit(base());
    expect(result.answer).toBe('ran');
    if (result.answer !== 'ran') return;
    expect(result.handBack).toEqual({ next: 'done', summary: 'finished' });
  });

  it('answers turn-limit for error_max_turns', () => {
    expect(sdkRunExit(base({ subtype: 'error_max_turns' })).answer).toBe('turn-limit');
  });

  it('answers spend-limit for error_max_budget_usd', () => {
    expect(sdkRunExit(base({ subtype: 'error_max_budget_usd' })).answer).toBe('spend-limit');
  });

  it('answers bound when aborted on the bound', () => {
    expect(sdkRunExit(base({ abortedOnBound: true })).answer).toBe('bound');
  });

  it('answers unstarted for an is_error with an unrelated terminal_reason', () => {
    const result = sdkRunExit(base({ isError: true, terminalReason: 'api_error' }));
    expect(result.answer).toBe('unstarted');
  });

  it('answers ran with no hand-back on success with no structured_output', () => {
    const result = sdkRunExit(base({ structuredOutput: null }));
    expect(result.answer).toBe('ran');
    if (result.answer !== 'ran') return;
    expect(result.handBack).toBeNull();
  });

  it('answers ran with no hand-back when structured_output does not match the schema', () => {
    const result = sdkRunExit(base({ structuredOutput: { next: 'something-else', summary: 'x' } }));
    expect(result.answer).toBe('ran');
    if (result.answer !== 'ran') return;
    expect(result.handBack).toBeNull();
  });

  it('answers ran with no hand-back for error_max_structured_output_retries', () => {
    const result = sdkRunExit(
      base({ subtype: 'error_max_structured_output_retries', structuredOutput: null }),
    );
    expect(result.answer).toBe('ran');
    if (result.answer !== 'ran') return;
    expect(result.handBack).toBeNull();
  });

  it('answers wait for a rate_limit_event with an allowed status and a known reset', () => {
    const result = sdkRunExit(
      base({
        rateLimitEvent: { status: 'allowed_warning', resetsAt: NOW + 4800 },
        terminalReason: 'blocking_limit',
      }),
    );
    expect(result.answer).toBe('wait');
  });

  it('answers unstarted with the startup_failure_reason when one is reported', () => {
    const result = sdkRunExit(base({ startupFailureReason: 'spawn ENOENT' }));
    expect(result).toEqual({ answer: 'unstarted', detail: 'spawn ENOENT' });
  });

  it('answers end-limited with no-reset for a limit-shaped terminal reason and no rate_limit_event', () => {
    const result = sdkRunExit(base({ terminalReason: 'rapid_refill_breaker', rateLimitEvent: null }));
    expect(result).toEqual({ answer: 'end-limited', cause: 'no-reset' });
  });

  it('answers end-limited past-bound for a rejected event whose reset is beyond the bound', () => {
    const result = sdkRunExit(
      base({
        rateLimitEvent: { status: 'rejected', resetsAt: NOW + 999999 },
        boundSeconds: 1800,
      }),
    );
    expect(result).toEqual({ answer: 'end-limited', cause: 'past-bound' });
  });

  it('answers unstarted with the subtype when is_error carries no terminal_reason', () => {
    const result = sdkRunExit(
      base({ isError: true, terminalReason: null, subtype: 'error_during_execution', numTurns: 3 }),
    );
    expect(result).toEqual({ answer: 'unstarted', detail: 'error_during_execution' });
  });

  it('answers unstarted with a fallback detail when is_error carries neither a terminal_reason nor a subtype', () => {
    const result = sdkRunExit(
      base({ isError: true, terminalReason: null, subtype: null, numTurns: 3 }),
    );
    expect(result).toEqual({ answer: 'unstarted', detail: 'is_error with no named reason' });
  });

  it('answers unstarted when the spawn produced no result message at all', () => {
    const result = sdkRunExit(base({ noResult: true, subtype: null, structuredOutput: null }));
    expect(result).toEqual({ answer: 'unstarted', detail: 'no result message arrived' });
  });

  it('reads a hand-back whose summary is missing as an empty string, never as a non-string value', () => {
    const result = sdkRunExit(base({ structuredOutput: { next: 'done' } }));
    expect(result.answer).toBe('ran');
    if (result.answer !== 'ran') return;
    expect(result.handBack).toEqual({ next: 'done', summary: '' });
  });
});
