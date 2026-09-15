import { describe, expect, it } from 'vitest';

import {
  SliceSpendSchema,
  decodeSliceSpend,
  encodeSliceSpend,
  type SliceSpend,
} from '../src/entities/slice-spend.js';
import { readSpend, spendSummary } from '../src/rules/slice-spend-record.js';

const record = (over: Partial<SliceSpend> = {}): SliceSpend => ({
  branch: 'feature/a',
  at: '2026-09-15T10:00:00.000Z',
  tokens: {
    inputTokens: 2,
    outputTokens: 169,
    cacheCreationTokens: 80_247,
    cacheReadTokens: 13_236,
  },
  turns: 1,
  models: ['claude-opus-5'],
  ...over,
});

describe('SliceSpendSchema', () => {
  it('holds exactly four token counters and refuses a summed fifth', () => {
    // THE KEY-SET ASSERTION THE PLAN PINS, at the schema rather than in prose.
    // `contextSpend` is already on the wire, so a total beside these four is a
    // two-line change no review would flag.
    const parsed = SliceSpendSchema.safeParse({
      ...record(),
      tokens: { ...record().tokens, totalTokens: 93_654 },
    });

    expect(parsed.success).toBe(false);
  });

  it('round-trips through the record line format', () => {
    expect(decodeSliceSpend(encodeSliceSpend(record()))).toEqual(record());
  });

  it('reads an unparseable line as null rather than repairing it', () => {
    expect(decodeSliceSpend('{"branch": tru')).toBeNull();
    expect(decodeSliceSpend('')).toBeNull();
    expect(decodeSliceSpend('{"branch":"feature/a"}')).toBeNull();
  });
});

describe('readSpend', () => {
  it('reports a branch it holds as measured, with its history', () => {
    const lines = [
      encodeSliceSpend(record({ at: '2026-09-15T10:00:00.000Z' })),
      encodeSliceSpend(record({ branch: 'feature/other' })),
      encodeSliceSpend(record({ at: '2026-09-15T12:00:00.000Z', turns: 9 })),
    ];

    const actual = readSpend(lines, 'feature/a');

    expect(actual.state).toBe('measured');
    expect(actual.history).toHaveLength(2);
    expect(actual.latest?.at).toBe('2026-09-15T12:00:00.000Z');
  });

  it('keeps a SECOND run as a second record rather than mutating the first', () => {
    // A measurement with a timestamp, never a running total nobody can place.
    const lines = [
      encodeSliceSpend(record({ at: '2026-09-15T10:00:00.000Z', turns: 3 })),
      encodeSliceSpend(record({ at: '2026-09-15T12:00:00.000Z', turns: 5 })),
    ];

    const actual = readSpend(lines, 'feature/a');

    expect(actual.history.map((entry) => entry.turns)).toEqual([3, 5]);
    expect(actual.latest?.turns).toBe(5);
  });

  it('reports a branch it does not hold as ABSENT, never as zero', () => {
    const actual = readSpend([encodeSliceSpend(record())], 'feature/never-ran');

    expect(actual.state).toBe('absent');
    expect(actual.latest).toBeNull();
  });

  it('keeps an unreadable record apart from an empty one', () => {
    // Read the exit code, not the emptiness: a failed call and an empty result
    // are different answers.
    expect(readSpend(null, 'feature/a').state).toBe('unreadable');
    expect(readSpend([], 'feature/a').state).toBe('absent');
  });

  it('counts a torn line without letting it become a branch record', () => {
    const actual = readSpend(['{"branch": tru', encodeSliceSpend(record())], 'feature/a');

    expect(actual.unreadable).toBe(1);
    expect(actual.history).toHaveLength(1);
  });

  it('does not count another branch line as unreadable', () => {
    const actual = readSpend([encodeSliceSpend(record({ branch: 'feature/other' }))], 'feature/a');

    expect(actual.unreadable).toBe(0);
    expect(actual.state).toBe('absent');
  });
});

describe('spendSummary', () => {
  it('tells a reader holding no record that it was NOT MEASURED HERE', () => {
    // The honesty the plan calls the deliverable: a colleague's checkout reads
    // nothing, not zero, and the sentence says which.
    expect(spendSummary(readSpend([], 'feature/a'))).toBe('not measured here');
  });

  it('names an unreadable record as unreadable rather than absent', () => {
    expect(spendSummary(readSpend(null, 'feature/a'))).toBe('spend record unreadable');
  });

  it('names all four counters and every model, and prints no total', () => {
    const actual = spendSummary(readSpend([encodeSliceSpend(record())], 'feature/a'));

    expect(actual).toBe('in 2, out 169, cache-write 80247, cache-read 13236 over 1 turns on claude-opus-5');
    expect(actual).not.toContain('93654');
  });

  it('says so where a record carries no model', () => {
    const actual = spendSummary(readSpend([encodeSliceSpend(record({ models: [] }))], 'feature/a'));

    expect(actual).toContain('model unrecorded');
  });
});
