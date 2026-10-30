import { describe, expect, it } from 'vitest';

import {
  decodeFixerAttempts,
  encodeFixerAttempts,
  FIXER_ATTEMPTS_VERSION,
  type FixerAttemptsRecord,
} from '../src/entities/fixer-attempts.js';
import {
  FIXER_ATTEMPTS_BUDGET,
  fixerAttemptsExhausted,
  fixerAttemptsSpent,
  fixerInFlight,
} from '../src/rules/fixer-attempts.js';

const record = (over: Partial<FixerAttemptsRecord> = {}): FixerAttemptsRecord => ({
  v: FIXER_ATTEMPTS_VERSION,
  pr: 42,
  attempts: [{ headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h1' } }],
  ...over,
});

describe('decodeFixerAttempts', () => {
  it('round-trips a record', () => {
    const r = record();
    expect(decodeFixerAttempts(encodeFixerAttempts(r))).toEqual(r);
  });

  it('round-trips an in-flight attempt', () => {
    const r = record({
      attempts: [
        { headSha: 'a'.repeat(40), finding: { kind: 'ci', runId: 'run-1' }, inFlight: { pid: 123, startedAt: '2026-10-29T00:00:00.000Z' } },
      ],
    });
    expect(decodeFixerAttempts(encodeFixerAttempts(r))).toEqual(r);
  });

  it.each(['', '   '])('reads %j as none', (text) => {
    expect(decodeFixerAttempts(text)).toBe('none');
  });

  it('reads unparseable text as unreadable', () => {
    expect(decodeFixerAttempts('{ not json')).toBe('unreadable');
  });

  it('reads a wrong-version record as unreadable, not as an empty one', () => {
    const other = JSON.stringify({ ...record(), v: FIXER_ATTEMPTS_VERSION + 1 });
    expect(decodeFixerAttempts(other)).toBe('unreadable');
  });

  it('reads a shape missing required fields as unreadable', () => {
    expect(decodeFixerAttempts(JSON.stringify({ v: FIXER_ATTEMPTS_VERSION }))).toBe('unreadable');
  });

  it('reads an unknown finding kind as unreadable', () => {
    const bad = JSON.stringify({
      v: FIXER_ATTEMPTS_VERSION,
      pr: 1,
      attempts: [{ headSha: 'a', finding: { kind: 'other' } }],
    });
    expect(decodeFixerAttempts(bad)).toBe('unreadable');
  });

  it('reads an unknown extra field as unreadable, since the schema is strict', () => {
    const bad = JSON.stringify({ ...record(), extra: true });
    expect(decodeFixerAttempts(bad)).toBe('unreadable');
  });
});

describe('fixerAttemptsSpent', () => {
  it('reads a missing record as zero attempts', () => {
    expect(fixerAttemptsSpent('none')).toBe(0);
  });

  it('reads a corrupt record as zero attempts, not as exhausted', () => {
    expect(fixerAttemptsSpent('unreadable')).toBe(0);
  });

  it('counts two attempts on different heads of one PR as two', () => {
    const r = record({
      attempts: [
        { headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h1' } },
        { headSha: 'b'.repeat(40), finding: { kind: 'high', hash: 'h1' } },
      ],
    });
    expect(fixerAttemptsSpent(r)).toBe(2);
  });
});

describe('fixerAttemptsExhausted', () => {
  it('is not exhausted below the budget', () => {
    expect(fixerAttemptsExhausted(record({ attempts: [] }))).toBe(false);
  });

  it('is exhausted once spent reaches the budget', () => {
    const attempts = Array.from({ length: FIXER_ATTEMPTS_BUDGET }, (_, i) => ({
      headSha: `${i}`.repeat(40),
      finding: { kind: 'high' as const, hash: 'h1' },
    }));
    expect(fixerAttemptsExhausted(record({ attempts }))).toBe(true);
  });

  it('is not exhausted on a missing or corrupt record', () => {
    expect(fixerAttemptsExhausted('none')).toBe(false);
    expect(fixerAttemptsExhausted('unreadable')).toBe(false);
  });
});

describe('fixerInFlight', () => {
  it('answers false — not in flight — for a missing record', () => {
    expect(fixerInFlight('none')).toBe(false);
  });

  it('answers true — holds — for an unreadable record, distinct from none in flight', () => {
    expect(fixerInFlight('unreadable')).toBe(true);
  });

  it('answers false when no attempt carries an in-flight mark', () => {
    expect(fixerInFlight(record())).toBe(false);
  });

  it('answers true when an attempt carries an in-flight mark', () => {
    const r = record({
      attempts: [
        {
          headSha: 'a'.repeat(40),
          finding: { kind: 'high', hash: 'h1' },
          inFlight: { pid: 1, startedAt: '2026-10-29T00:00:00.000Z' },
        },
      ],
    });
    expect(fixerInFlight(r)).toBe(true);
  });
});
