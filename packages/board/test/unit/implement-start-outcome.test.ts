import { describe, expect, it } from 'vitest';
import { implementStartOutcome } from '../../src/app/lib/implement-start-outcome.js';

describe('implementStartOutcome', () => {
  it('reads the running refusal as running', () => {
    expect(implementStartOutcome(409, { error: 'an implement for `x` is already running', running: true })).toEqual({ kind: 'running' });
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
