import { describe, expect, it } from 'vitest';
import { implementStartOutcome } from '../../src/app/lib/implement-start-outcome.js';

describe('implementStartOutcome', () => {
  it('reads the running refusal of this checkout\'s implement run as running', () => {
    expect(
      implementStartOutcome(409, { error: 'an implement for `x` is already running', running: true, holder: 'implement' }),
    ).toEqual({ kind: 'running' });
  });

  it('reads a running refusal held by a brief run, a desk or an unnamed run as failed, with its text', () => {
    for (const holder of ['brief', 'desk', 'unknown', undefined]) {
      expect(implementStartOutcome(409, { error: `held by ${String(holder)}`, running: true, holder })).toEqual({
        kind: 'failed',
        message: `held by ${String(holder)}`,
      });
    }
  });

  it('reads a 409 without the running mark as failed, with its detail', () => {
    expect(implementStartOutcome(409, { ok: false, reason: 'no-implement-command', detail: 'no key' })).toEqual({ kind: 'failed', message: 'no key' });
  });

  it('reads a 500 as failed', () => {
    expect(implementStartOutcome(500, { error: 'cannot open log' })).toEqual({ kind: 'failed', message: 'cannot open log' });
  });

  it('reads a 202 as running', () => {
    expect(implementStartOutcome(202, { ok: true })).toEqual({ kind: 'running' });
  });
});
