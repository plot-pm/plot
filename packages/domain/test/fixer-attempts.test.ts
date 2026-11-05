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
  fixerPushedHead,
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

describe('record versioning', () => {
  it('decodes a record written by the current schema at version 1', () => {
    const written = JSON.stringify({
      v: 1,
      pr: 42,
      attempts: [
        { headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h1' } },
        { headSha: 'a'.repeat(40), finding: { kind: 'ci', runId: 'r' }, start: 'failed', pushedSha: 'b'.repeat(40) },
      ],
    });
    const decoded = decodeFixerAttempts(written);
    expect(decoded).not.toBe('unreadable');
    expect(decoded).not.toBe('none');
    expect(decoded).toMatchObject({ v: 1, attempts: [{}, { pushedSha: 'b'.repeat(40) }] });
  });
});

describe('fixerAttemptsSpent', () => {
  it('reads a missing record as zero attempts', () => {
    expect(fixerAttemptsSpent('none', 'high')).toBe(0);
  });

  it('reads a corrupt record as zero attempts, not as exhausted', () => {
    expect(fixerAttemptsSpent('unreadable', 'high')).toBe(0);
  });

  it('counts two attempts on different heads of one PR as two', () => {
    const r = record({
      attempts: [
        { headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h1' } },
        { headSha: 'b'.repeat(40), finding: { kind: 'high', hash: 'h1' } },
      ],
    });
    expect(fixerAttemptsSpent(r, 'high')).toBe(2);
  });
});

describe('fixerAttemptsSpent by kind', () => {
  const ciAttempt = (i: number) => ({ headSha: `${i}`.repeat(40), finding: { kind: 'ci' as const, runId: `${i}` } });

  it('two CI-red attempts leave the HIGH budget unspent', () => {
    const r = record({ attempts: [ciAttempt(1), ciAttempt(2)] });
    expect(fixerAttemptsSpent(r, 'high')).toBe(0);
    expect(fixerAttemptsExhausted(r, 'high')).toBe(false);
    expect(fixerAttemptsExhausted(r, 'ci')).toBe(true);
  });
});

describe('fixerPushedHead', () => {
  it('proves a head only from an attempt that recorded it', () => {
    const r = record({ attempts: [{ headSha: 'a'.repeat(40), finding: { kind: 'ci', runId: '1' }, pushedSha: 'b'.repeat(40) }] });
    expect(fixerPushedHead(r, 'b'.repeat(40))).toBe(true);
    expect(fixerPushedHead(r, 'a'.repeat(40))).toBe(false);
    expect(fixerPushedHead('none', 'b'.repeat(40))).toBe(false);
    expect(fixerPushedHead('unreadable', 'b'.repeat(40))).toBe(false);
  });
});

describe('fixerAttemptsExhausted', () => {
  it('is not exhausted below the budget', () => {
    expect(fixerAttemptsExhausted(record({ attempts: [] }), 'high')).toBe(false);
  });

  it('is exhausted once spent reaches the budget', () => {
    const attempts = Array.from({ length: FIXER_ATTEMPTS_BUDGET }, (_, i) => ({
      headSha: `${i}`.repeat(40),
      finding: { kind: 'high' as const, hash: 'h1' },
    }));
    expect(fixerAttemptsExhausted(record({ attempts }), 'high')).toBe(true);
  });

  it('is not exhausted on a missing or corrupt record', () => {
    expect(fixerAttemptsExhausted('none', 'high')).toBe(false);
    expect(fixerAttemptsExhausted('unreadable', 'high')).toBe(false);
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

describe('a failed start spends no attempt', () => {
  const failedStarts = record({
    attempts: [
      { headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h1' }, start: 'failed' },
      { headSha: 'a'.repeat(40), finding: { kind: 'high', hash: 'h2' }, start: 'failed' },
    ],
  });

  it('counts none of two failed starts', () => {
    expect(fixerAttemptsSpent(failedStarts, 'high')).toBe(0);
    expect(fixerAttemptsExhausted(failedStarts, 'high')).toBe(false);
  });

  it('counts the attempts that ran next to a failed one', () => {
    const mixed = record({ attempts: [...failedStarts.attempts, { headSha: 'b'.repeat(40), finding: { kind: 'high', hash: 'h3' } }] });
    expect(fixerAttemptsSpent(mixed, 'high')).toBe(1);
  });

  it('decodes a record with no start field at version 1', () => {
    const decoded = decodeFixerAttempts(JSON.stringify(record()));
    expect(decoded).not.toBe('unreadable');
    expect(decoded === 'none' || decoded === 'unreadable' ? undefined : decoded.attempts[0]!.start).toBeUndefined();
    expect(FIXER_ATTEMPTS_VERSION).toBe(1);
  });
});
