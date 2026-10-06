import { describe, expect, it } from 'vitest';

import {
  SliceSpendSchema,
  SliceSpendSealSchema,
  decodeSliceSpend,
  encodeSliceSpend,
  type SliceSpend,
  type SliceSpendRun,
  type SliceSpendSeal,
} from '../src/entities/slice-spend.js';
import type { AgentRunResult } from '../src/ports/agent-run.js';
import type { SliceSpendRecord } from '../src/ports/slice-spend.js';
import { readSpend, spendSummary } from '../src/rules/slice-spend-record.js';
import { recordSliceRun } from '../src/workflows/slice-spend.js';

const record = (over: Partial<SliceSpendSeal> = {}): SliceSpendSeal => ({
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

/** One SDK run line — carries a SESSION'S CUMULATIVE figures, never a delta. */
const run = (over: Partial<SliceSpendRun> = {}): SliceSpendRun => ({
  kind: 'run',
  branch: 'feature/a',
  at: '2026-09-15T10:00:00.000Z',
  sessionId: 'session-1',
  role: 'worker',
  models: {
    'claude-opus-5': {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
      costUsd: 10,
    },
  },
  costUsd: 10,
  turns: 3,
  ...over,
});

/** A run line with every counter and the cost at zero — a run that didn't start. */
const zeroedRun = (over: Partial<SliceSpendRun> = {}): SliceSpendRun =>
  run({
    models: {
      'claude-opus-5': {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      },
    },
    costUsd: 0,
    ...over,
  });

/** One SDK connector result, as `recordSliceRun`'s caller hands it over. */
const runResult = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  sessionId: 'session-1',
  end: { answer: 'ran', handBack: null },
  usageByModel: {
    'claude-opus-5': { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 },
  },
  costUsd: 10,
  costUsdByModel: { 'claude-opus-5': 10 },
  turns: 3,
  limitReadings: [],
  account: null,
  ...over,
});

/** A fake record port — one in-memory list, appended to and nothing else. */
const fakeRecord = (overAppend: SliceSpendRecord['append'] | null = null): SliceSpendRecord & { appended: SliceSpend[] } => {
  const appended: SliceSpend[] = [];
  return {
    appended,
    location: () => ({ ok: true, value: '/fake/slice-spend.jsonl' }),
    sessions: async () => ({ ok: true, value: [] }),
    lines: async () => ({ ok: true, value: [] }),
    append: overAppend ?? (async (entry: SliceSpend) => {
      appended.push(entry);
      return { ok: true, value: undefined };
    }),
  };
};

describe('recordSliceRun', () => {
  it('appends one run line carrying the result’s figures verbatim', async () => {
    const port = fakeRecord();

    const written = await recordSliceRun(
      port,
      { branch: 'feature/a', role: 'worker', at: '2026-09-15T18:00:00.000Z' },
      runResult(),
    );

    expect(written).toEqual({
      ok: true,
      record: {
        kind: 'run',
        branch: 'feature/a',
        at: '2026-09-15T18:00:00.000Z',
        sessionId: 'session-1',
        role: 'worker',
        models: {
          'claude-opus-5': {
            inputTokens: 10,
            outputTokens: 20,
            cacheCreationTokens: 30,
            cacheReadTokens: 40,
            costUsd: 10,
          },
        },
        costUsd: 10,
        turns: 3,
      },
    });
    expect(port.appended).toEqual([written.ok ? written.record : null]);
  });

  it('writes each model’s own costUsd, and the run’s total on the line', async () => {
    const port = fakeRecord();

    const written = await recordSliceRun(
      port,
      { branch: 'feature/a', role: 'worker', at: '2026-09-15T18:00:00.000Z' },
      runResult({
        usageByModel: {
          'claude-opus-5': { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
          'claude-sonnet-5': { inputTokens: 5, outputTokens: 6, cacheCreationTokens: 7, cacheReadTokens: 8 },
        },
        costUsd: 42,
        costUsdByModel: { 'claude-opus-5': 40, 'claude-sonnet-5': 2 },
      }),
    );

    const record = written.ok ? written.record : null;
    expect(record?.models['claude-opus-5']?.costUsd).toBe(40);
    expect(record?.models['claude-sonnet-5']?.costUsd).toBe(2);
    expect(record?.costUsd).toBe(42);
  });

  it('refuses a run whose model carries no cost, rather than writing a zero', async () => {
    const port = fakeRecord();

    const written = await recordSliceRun(
      port,
      { branch: 'feature/a', role: 'worker', at: '2026-09-15T18:00:00.000Z' },
      runResult({ costUsdByModel: {} }),
    );

    expect(written).toEqual({ ok: false, refusal: 'no-cost' });
    expect(port.appended).toEqual([]);
  });

  it('refuses a run that names no branch', async () => {
    const port = fakeRecord();

    const written = await recordSliceRun(port, { branch: '', role: 'worker', at: '2026-09-15T18:00:00.000Z' }, runResult());

    expect(written).toEqual({ ok: false, refusal: 'no-branch' });
    expect(port.appended).toEqual([]);
  });

  it('refuses a run the connector reported no cost for, rather than writing a zero', async () => {
    const port = fakeRecord();

    const written = await recordSliceRun(
      port,
      { branch: 'feature/a', role: 'worker', at: '2026-09-15T18:00:00.000Z' },
      runResult({ costUsd: null }),
    );

    expect(written).toEqual({ ok: false, refusal: 'no-cost' });
    expect(port.appended).toEqual([]);
  });

  it('reports a write failure rather than claiming the line was recorded', async () => {
    const port = fakeRecord(async () => ({ ok: false, why: 'failed' }));

    const written = await recordSliceRun(
      port,
      { branch: 'feature/a', role: 'worker', at: '2026-09-15T18:00:00.000Z' },
      runResult(),
    );

    expect(written).toEqual({ ok: false, refusal: 'write-failed' });
  });
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

  it('round-trips a run line through the same format', () => {
    expect(decodeSliceSpend(encodeSliceSpend(run()))).toEqual(run());
  });

  it('reads a run line as unreadable through a seal-only schema', () => {
    // AN OLDER PLOT, which has no `kind` member to fall through to. Simulated
    // here with the seal schema alone rather than a second Plot binary.
    const line = encodeSliceSpend(run());
    expect(SliceSpendSchema.safeParse(JSON.parse(line)).success).toBe(true);
    expect(SliceSpendSealSchema.safeParse(JSON.parse(line)).success).toBe(false);
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

  it('skips a blank line without counting it as unreadable', () => {
    const actual = readSpend(['', encodeSliceSpend(record()), '  '], 'feature/a');

    expect(actual.unreadable).toBe(0);
    expect(actual.history).toHaveLength(1);
  });

  it('does not count another branch line as unreadable', () => {
    const actual = readSpend([encodeSliceSpend(record({ branch: 'feature/other' }))], 'feature/a');

    expect(actual.unreadable).toBe(0);
    expect(actual.state).toBe('absent');
  });
});

describe('readSpend over run lines', () => {
  it('gives a resumed session’s second run the SECOND RUN’S INCREASE, not its value', () => {
    // The pinned case: two run lines of one resumed session. The SDK's figures
    // are cumulative for the session, so the second line restates the first
    // run's cost plus what the second run itself added.
    const first = run({
      sessionId: 'session-1',
      at: '2026-09-15T10:00:00.000Z',
      models: {
        'claude-opus-5': { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, costUsd: 10 },
      },
      costUsd: 10,
      turns: 3,
    });
    const second = run({
      sessionId: 'session-1',
      at: '2026-09-15T11:00:00.000Z',
      models: {
        'claude-opus-5': { inputTokens: 15, outputTokens: 25, cacheCreationTokens: 35, cacheReadTokens: 45, costUsd: 18 },
      },
      costUsd: 18,
      turns: 2,
    });

    const actual = readSpend([encodeSliceSpend(first), encodeSliceSpend(second)], 'feature/a');

    expect(actual.state).toBe('measured');
    expect(actual.costUsd).toBe(18);
    expect(actual.tokens).toEqual({ inputTokens: 15, outputTokens: 25, cacheCreationTokens: 35, cacheReadTokens: 45 });
    expect(actual.turns).toBe(5);
    expect(actual.runCount).toBe(1);
  });

  it('adds a counter reset’s own value rather than subtracting a now-stale baseline', () => {
    const first = run({ sessionId: 'session-1', costUsd: 10, turns: 1 });
    const resetLine = run({
      sessionId: 'session-1',
      costUsd: 4,
      turns: 1,
      models: {
        'claude-opus-5': { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 1, cacheReadTokens: 1, costUsd: 4 },
      },
    });

    const actual = readSpend([encodeSliceSpend(first), encodeSliceSpend(resetLine)], 'feature/a');

    expect(actual.costUsd).toBe(14);
    expect(actual.tokens?.inputTokens).toBe(11);
  });

  it('sums a seal line plus run lines for a branch that holds both', () => {
    // Build item 3: a slice that changed runner carries one seal line for its
    // `command` sessions and run lines for its SDK sessions. The total is the
    // sum over every session plus the newest seal.
    const seal = record({ tokens: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, turns: 2 });
    const theRun = run({
      models: {
        'claude-opus-5': { inputTokens: 5, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 1 },
      },
      costUsd: 1,
      turns: 1,
    });

    const actual = readSpend([encodeSliceSpend(seal), encodeSliceSpend(theRun)], 'feature/a');

    expect(actual.state).toBe('measured');
    expect(actual.tokens?.inputTokens).toBe(105);
    expect(actual.turns).toBe(3);
  });

  it('reads $10, $0, $15 as $15 — a zeroed run adds nothing and is not a baseline', () => {
    const ten = run({ sessionId: 'session-1', costUsd: 10 });
    const zero = zeroedRun({ sessionId: 'session-1' });
    const fifteen = run({
      sessionId: 'session-1',
      costUsd: 15,
      models: {
        'claude-opus-5': { inputTokens: 12, outputTokens: 22, cacheCreationTokens: 32, cacheReadTokens: 42, costUsd: 15 },
      },
    });

    const actual = readSpend(
      [encodeSliceSpend(ten), encodeSliceSpend(zero), encodeSliceSpend(fifteen)],
      'feature/a',
    );

    expect(actual.costUsd).toBe(15);
  });

  it('adds a model that only appears on a later run of the same session in full', () => {
    // A SECOND MODEL JOINING MID-SESSION — a correction that moves the run onto
    // a different model partway through. The new model has no prior line to
    // subtract against, so its whole cumulative figure is the increase.
    const first = run({
      sessionId: 'session-1',
      models: {
        'claude-opus-5': { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, costUsd: 10 },
      },
      costUsd: 10,
    });
    const second = run({
      sessionId: 'session-1',
      costUsd: 13,
      models: {
        'claude-opus-5': { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, costUsd: 10 },
        'claude-haiku-4-5': { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4, costUsd: 3 },
      },
    });

    const actual = readSpend([encodeSliceSpend(first), encodeSliceSpend(second)], 'feature/a');

    expect(actual.costUsd).toBe(13);
    expect(actual.tokens).toEqual({ inputTokens: 11, outputTokens: 22, cacheCreationTokens: 33, cacheReadTokens: 44 });
    expect(actual.models).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });

  it('groups two distinct sessions separately rather than summing them as one', () => {
    const actual = readSpend(
      [
        encodeSliceSpend(run({ sessionId: 'session-1', costUsd: 10 })),
        encodeSliceSpend(run({ sessionId: 'session-2', costUsd: 7 })),
      ],
      'feature/a',
    );

    expect(actual.runCount).toBe(2);
    expect(actual.costUsd).toBe(17);
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
