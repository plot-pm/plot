import { describe, expect, it } from 'vitest';

import { unblockOutcome } from '../src/rules/unblock-outcome.js';

describe('unblockOutcome', () => {
  it('reads an `ANSWER` line as the answer, with the rest of the output as its text', () => {
    expect(unblockOutcome('ANSWER\nuse adapter B')).toEqual({ kind: 'answer', text: 'use adapter B' });
  });

  it('reads an `ESCALATE:` line as an escalation, with its reason', () => {
    expect(unblockOutcome('ESCALATE: scope adds a slice')).toEqual({
      kind: 'escalate',
      reason: 'scope adds a slice',
    });
  });

  it('refuses `unparseable-run` for an `ESCALATE:` with no reason', () => {
    expect(unblockOutcome('ESCALATE:')).toEqual({ kind: 'refused', why: 'unparseable-run' });
  });

  it('refuses `unparseable-run` for an `ANSWER` with no following text', () => {
    expect(unblockOutcome('ANSWER\n')).toEqual({ kind: 'refused', why: 'unparseable-run' });
  });

  it('refuses `unparseable-run` for free prose carrying neither prefix', () => {
    expect(unblockOutcome('I think the answer is adapter B.')).toEqual({ kind: 'refused', why: 'unparseable-run' });
  });

  it('reads the first non-empty line, trimmed, past leading blank lines and a CRLF ending', () => {
    expect(unblockOutcome('\n  \r\n ANSWER \r\nuse adapter B\r\n')).toEqual({ kind: 'answer', text: 'use adapter B' });
    expect(unblockOutcome('\n\nESCALATE: scope adds a slice\r\n')).toEqual({
      kind: 'escalate',
      reason: 'scope adds a slice',
    });
  });

  it('refuses `unparseable-run` for output holding only blank lines', () => {
    expect(unblockOutcome('\n \r\n\t\n')).toEqual({ kind: 'refused', why: 'unparseable-run' });
  });

  it('refuses `unparseable-run` for empty output', () => {
    expect(unblockOutcome('')).toEqual({ kind: 'refused', why: 'unparseable-run' });
  });
});
