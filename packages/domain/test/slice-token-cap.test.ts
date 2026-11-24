import { describe, expect, it } from 'vitest';

import { answered, failed } from '../src/port-result.js';
import { encodeSliceSpend, type SliceSpendRun, type SliceSpendSeal } from '../src/entities/slice-spend.js';
import type { SliceSpendRecord } from '../src/ports/slice-spend.js';
import type { TranscriptLine } from '../src/rules/slice-tokens.js';
import { countedTokens, sliceTokenCap } from '../src/rules/slice-token-cap.js';
import { readSliceTokens } from '../src/workflows/slice-spend.js';

const BRANCH = 'feature/the-default-runner-has-a-spend-cap';
const DESK = '/desk';

const tokens = (input: number, output: number, cacheCreation: number, cacheRead: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: cacheCreation,
  cacheReadTokens: cacheRead,
});

/** A port that answers exactly what a test tells it to, and counts its transcript reads. */
const stubRecord = (over: Partial<SliceSpendRecord> = {}): SliceSpendRecord & { appended: number } => {
  const port = {
    appended: 0,
    location: () => answered('/tmp/nowhere/slice-spend.jsonl'),
    sessions: async () => answered([]),
    append: async () => {
      port.appended += 1;
      return answered(undefined);
    },
    lines: async () => answered([]),
    ...over,
  };
  return port as SliceSpendRecord & { appended: number };
};

/** One assistant turn on `gitBranch` carrying every counter. */
const turn = (gitBranch: string, input: number, output: number, cacheCreation: number, cacheRead: number): TranscriptLine => ({
  type: 'assistant',
  gitBranch,
  message: {
    model: 'claude-opus-5',
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
    },
  },
});

const seal = (over: Partial<SliceSpendSeal> = {}): string =>
  encodeSliceSpend({
    branch: BRANCH,
    at: '2026-11-24T10:00:00.000Z',
    tokens: tokens(100, 100, 100, 9_000),
    turns: 1,
    models: ['claude-opus-5'],
    ...over,
  });

const runLine = (sessionId: string, counts: ReturnType<typeof tokens>): string => {
  const run: SliceSpendRun = {
    kind: 'run',
    branch: BRANCH,
    at: '2026-11-24T10:00:00.000Z',
    sessionId,
    role: 'worker',
    models: { 'claude-opus-5': { ...counts, costUsd: 1 } },
    costUsd: 1,
    turns: 1,
  };
  return encodeSliceSpend(run);
};

describe('sliceTokenCap', () => {
  it('answers under below the cap', () => {
    expect(sliceTokenCap(tokens(300, 300, 399, 0), 1000)).toBe('under');
  });

  it('answers reached exactly at the cap', () => {
    expect(sliceTokenCap(tokens(300, 300, 400, 0), 1000)).toBe('reached');
  });

  it('answers reached past the cap', () => {
    expect(sliceTokenCap(tokens(5000, 0, 0, 0), 1000)).toBe('reached');
  });

  it('answers unread where the tokens could not be read, never under or reached', () => {
    expect(sliceTokenCap(null, 1000)).toBe('unread');
  });

  it('counts cache-read tokens at zero, so a cache-read-heavy slice under the cap on the counted kinds is under', () => {
    expect(sliceTokenCap(tokens(10, 10, 10, 50_000_000), 1000)).toBe('under');
  });

  it('counts input, output and cache-creation tokens, each one', () => {
    expect(countedTokens(tokens(1, 20, 300, 4000))).toBe(321);
    expect(sliceTokenCap(tokens(1000, 0, 0, 0), 1000)).toBe('reached');
    expect(sliceTokenCap(tokens(0, 1000, 0, 0), 1000)).toBe('reached');
    expect(sliceTokenCap(tokens(0, 0, 1000, 0), 1000)).toBe('reached');
  });
});

describe('readSliceTokens', () => {
  it('a command slice with no seal line reads its transcripts, so the cap fires over them', async () => {
    const record = stubRecord({
      sessions: async () => answered([{ sessionId: 's1', lines: [turn(BRANCH, 600, 300, 200, 0)] }]),
    });
    const read = await readSliceTokens(record, { worktree: DESK, branch: BRANCH });
    expect(read).toEqual({ kind: 'read', tokens: tokens(600, 300, 200, 0) });
    expect(sliceTokenCap(read.kind === 'read' ? read.tokens : null, 1000)).toBe('reached');
  });

  it('adds the unsealed transcripts to the record total', async () => {
    const record = stubRecord({
      lines: async () => answered([seal()]),
      sessions: async () => answered([{ sessionId: 's2', lines: [turn(BRANCH, 10, 20, 30, 40)] }]),
    });
    expect(await readSliceTokens(record, { worktree: DESK, branch: BRANCH })).toEqual({
      kind: 'read',
      tokens: tokens(110, 120, 130, 9_040),
    });
  });

  it('a session that already has a run line is not summed twice', async () => {
    const record = stubRecord({
      lines: async () => answered([runLine('sdk-1', tokens(400, 100, 0, 0))]),
      sessions: async () => answered([{ sessionId: 'sdk-1', lines: [turn(BRANCH, 400, 100, 0, 0)] }]),
    });
    const read = await readSliceTokens(record, { worktree: DESK, branch: BRANCH });
    expect(read).toEqual({ kind: 'read', tokens: tokens(400, 100, 0, 0) });
    expect(sliceTokenCap(read.kind === 'read' ? read.tokens : null, 1000)).toBe('under');
  });

  it('sums a command session beside an SDK session whose run line holds it', async () => {
    const record = stubRecord({
      lines: async () => answered([runLine('sdk-1', tokens(400, 100, 0, 0))]),
      sessions: async () =>
        answered([
          { sessionId: 'sdk-1', lines: [turn(BRANCH, 400, 100, 0, 0)] },
          { sessionId: 'cmd-1', lines: [turn(BRANCH, 1, 2, 3, 4)] },
        ]),
    });
    expect(await readSliceTokens(record, { worktree: DESK, branch: BRANCH })).toEqual({
      kind: 'read',
      tokens: tokens(401, 102, 3, 4),
    });
  });

  it('counts only this branch’s turns', async () => {
    const record = stubRecord({
      sessions: async () => answered([{ sessionId: 's1', lines: [turn('feature/other', 5000, 0, 0, 0), turn(BRANCH, 1, 0, 0, 0)] }]),
    });
    expect(await readSliceTokens(record, { worktree: DESK, branch: BRANCH })).toEqual({ kind: 'read', tokens: tokens(1, 0, 0, 0) });
  });

  it('a fresh slice with no record line and no turn reads zero', async () => {
    expect(await readSliceTokens(stubRecord(), { worktree: DESK, branch: BRANCH })).toEqual({ kind: 'read', tokens: tokens(0, 0, 0, 0) });
  });

  it('answers unread, naming the reason, where the transcripts cannot be read', async () => {
    const read = await readSliceTokens(stubRecord({ sessions: async () => failed() }), { worktree: DESK, branch: BRANCH });
    expect(read.kind).toBe('unread');
    expect(read.kind === 'unread' && read.reason).toMatch(/transcripts/);
  });

  it('answers unread, naming the reason, where the record cannot be read', async () => {
    const read = await readSliceTokens(stubRecord({ lines: async () => failed() }), { worktree: DESK, branch: BRANCH });
    expect(read.kind).toBe('unread');
    expect(read.kind === 'unread' && read.reason).toMatch(/record/);
  });

  it('writes nothing to the record', async () => {
    const record = stubRecord({
      sessions: async () => answered([{ sessionId: 's1', lines: [turn(BRANCH, 600, 300, 200, 0)] }]),
    });
    await readSliceTokens(record, { worktree: DESK, branch: BRANCH });
    expect(record.appended).toBe(0);
  });
});
