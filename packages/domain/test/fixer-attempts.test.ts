import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  decodeFixerAttempts,
  encodeFixerAttempts,
  FixerAttemptSchema,
  FIXER_ATTEMPTS_VERSION,
  type FixerAttemptsRecord,
} from '../src/entities/fixer-attempts.js';
import {
  FIXER_ATTEMPTS_BUDGET,
  fixerAttemptsExhausted,
  fixerAttemptsSpent,
  fixerConflictTried,
  fixerInFlight,
  fixerPushedHead,
  fixerReadingOf,
  fixerRerunAnswer,
  rerunOnHead,
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

describe('the conflict finding', () => {
  const HEAD = 'a'.repeat(40);
  const TIP = 'c'.repeat(40);
  const conflictRecord = record({ attempts: [{ headSha: HEAD, finding: { kind: 'conflict', head: HEAD, baseTip: TIP } }] });

  it('round-trips at version 1', () => {
    expect(FIXER_ATTEMPTS_VERSION).toBe(1);
    expect(decodeFixerAttempts(encodeFixerAttempts(conflictRecord))).toEqual(conflictRecord);
  });

  it('reads as unreadable to a reader that knows only the high and ci findings', () => {
    const oldFinding = z.union([
      z.object({ kind: z.literal('high'), hash: z.string().min(1) }).strict(),
      z.object({ kind: z.literal('ci'), runId: z.string().min(1) }).strict(),
    ]);
    const oldRecord = z
      .object({ v: z.literal(1), pr: z.number(), attempts: z.array(FixerAttemptSchema.extend({ finding: oldFinding })) })
      .strict();
    expect(oldRecord.safeParse(JSON.parse(encodeFixerAttempts(conflictRecord))).success).toBe(false);
    expect(oldRecord.safeParse(JSON.parse(encodeFixerAttempts(record()))).success).toBe(true);
  });

  it('refuses a conflict finding with no base tip', () => {
    const text = JSON.stringify({ v: 1, pr: 42, attempts: [{ headSha: HEAD, finding: { kind: 'conflict', head: HEAD, baseTip: '' } }] });
    expect(decodeFixerAttempts(text)).toBe('unreadable');
  });

  it('counts conflict attempts apart from high and ci', () => {
    const r = record({
      attempts: [
        { headSha: HEAD, finding: { kind: 'ci', runId: HEAD } },
        { headSha: HEAD, finding: { kind: 'conflict', head: HEAD, baseTip: TIP } },
      ],
    });
    expect(fixerAttemptsSpent(r, 'conflict')).toBe(1);
    expect(fixerAttemptsSpent(r, 'ci')).toBe(1);
    expect(fixerAttemptsSpent(r, 'high')).toBe(0);
  });

  it('names an attempt on this head and this base tip, and no other pair', () => {
    expect(fixerConflictTried(conflictRecord, HEAD, TIP)).toBe(true);
    expect(fixerConflictTried(conflictRecord, HEAD, 'd'.repeat(40))).toBe(false);
    expect(fixerConflictTried(conflictRecord, 'e'.repeat(40), TIP)).toBe(false);
    expect(fixerConflictTried(conflictRecord, HEAD, '')).toBe(false);
    expect(fixerConflictTried('none', HEAD, TIP)).toBe(false);
    expect(fixerConflictTried('unreadable', HEAD, TIP)).toBe(false);
  });

  it('does not name a failed start', () => {
    const failed = record({ attempts: [{ headSha: HEAD, finding: { kind: 'conflict', head: HEAD, baseTip: TIP }, start: 'failed' }] });
    expect(fixerConflictTried(failed, HEAD, TIP)).toBe(false);
    expect(fixerAttemptsSpent(failed, 'conflict')).toBe(0);
  });

  it('fills the conflict cells of the reading', () => {
    expect(fixerReadingOf(conflictRecord, HEAD, TIP)).toMatchObject({ conflictTried: true, conflictExhausted: false });
    expect(fixerReadingOf(conflictRecord, HEAD)).toMatchObject({ conflictTried: false });
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

describe('fixerReadingOf', () => {
  const ci = (i: number) => ({ headSha: `${i}`.repeat(40), finding: { kind: 'ci' as const, runId: `${i}` } });

  it('reads an unreadable record as unread', () => {
    expect(fixerReadingOf('unreadable', 'h')).toEqual({ read: 'unread' });
  });

  it('reads a missing record as nothing spent, nothing in flight and no pushed head', () => {
    expect(fixerReadingOf('none', 'h')).toEqual({
      read: 'record',
      inFlight: false,
      highExhausted: false,
      ciExhausted: false, conflictExhausted: false, conflictTried: false,
      pushedHead: false,
    });
  });

  it('splits the budgets and reads a pushed head only for a non-empty head', () => {
    const r = record({ attempts: [{ ...ci(1), pushedSha: 'p' }, ci(2)] });
    expect(fixerReadingOf(r, 'p')).toMatchObject({ highExhausted: false, ciExhausted: true, conflictExhausted: false, conflictTried: false, pushedHead: true });
    expect(fixerReadingOf(r, '')).toMatchObject({ pushedHead: false });
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

describe('the re-run on a head', () => {
  const HEAD = 'a'.repeat(40);
  const AT = '2026-11-23T12:00:00.000Z';
  const clock = { now: Date.parse(AT) + 60_000, checksWaitMs: 3_600_000 };
  const withRerun = (rerun: Record<string, unknown>): FixerAttemptsRecord => record({ reruns: [{ headSha: HEAD, at: AT, answer: 'asked', ...rerun }] });

  it('round-trips a record with a re-run', () => {
    const r = withRerun({ cleared: '2026-11-23T12:05:00.000Z' });
    expect(decodeFixerAttempts(encodeFixerAttempts(r))).toEqual(r);
  });

  it('reads an unknown re-run answer as unreadable', () => {
    expect(decodeFixerAttempts(JSON.stringify(withRerun({ answer: 'maybe' })))).toBe('unreadable');
  });

  it('reads no record, no entry and an empty head as none', () => {
    expect(rerunOnHead('none', HEAD, clock)).toBe('none');
    expect(rerunOnHead(record(), HEAD, clock)).toBe('none');
    expect(rerunOnHead(withRerun({}), '', clock)).toBe('none');
    expect(rerunOnHead(withRerun({}), 'b'.repeat(40), clock)).toBe('none');
  });

  it('reads an asked re-run inside Checks wait as running', () => {
    expect(rerunOnHead(withRerun({}), HEAD, clock)).toBe('running');
    expect(rerunOnHead(withRerun({}), HEAD, { ...clock, now: Date.parse(AT) + clock.checksWaitMs })).toBe('running');
  });

  it('reads a cleared re-run, and one never asked, as done', () => {
    expect(rerunOnHead(withRerun({ cleared: AT }), HEAD, clock)).toBe('done');
    expect(rerunOnHead(withRerun({ answer: 'failed' }), HEAD, clock)).toBe('done');
    expect(rerunOnHead(withRerun({ answer: 'unaskable' }), HEAD, clock)).toBe('done');
  });

  it('reads an asked re-run past Checks wait, or with an unparseable time, as unseen', () => {
    expect(rerunOnHead(withRerun({}), HEAD, { ...clock, now: Date.parse(AT) + clock.checksWaitMs + 1 })).toBe('unseen');
    expect(rerunOnHead(withRerun({ at: 'not a time' }), HEAD, clock)).toBe('unseen');
  });

  it('names the answer recorded on the head, or none', () => {
    expect(fixerRerunAnswer(withRerun({ answer: 'unaskable' }), HEAD)).toBe('unaskable');
    expect(fixerRerunAnswer(withRerun({}), 'b'.repeat(40))).toBe('none');
    expect(fixerRerunAnswer('unreadable', HEAD)).toBe('none');
  });

  it('adds the re-run to the fixer reading only when a clock is given', () => {
    expect(fixerReadingOf(withRerun({}), HEAD)).not.toHaveProperty('rerun');
    expect(fixerReadingOf(withRerun({}), HEAD, '', clock)).toMatchObject({ rerun: 'running' });
  });
});
