import { describe, expect, it } from 'vitest';

import { answered, failed, type PortResult } from '../src/port-result.js';
import { encodeSliceSpend, type SliceSpend } from '../src/entities/slice-spend.js';
import type { SliceSpendRecord } from '../src/ports/slice-spend.js';
import type { TranscriptLine } from '../src/rules/slice-tokens.js';
import { readSpend } from '../src/rules/slice-spend-record.js';
import { sliceTokens } from '../src/rules/slice-tokens.js';
import { readSliceSpend, recordSliceSpend } from '../src/workflows/slice-spend.js';

/**
 * THE REFUSAL PATHS, WHICH ARE THE PLAN'S ACTUAL DELIVERABLE.
 *
 * A record that says `0` where it means *nothing was measured* is the failure
 * this whole design exists to avoid, so every path that declines to write one
 * is tested for the WORD it answers with rather than for the absence of a
 * throw. They are reachable without a filesystem because the domain takes
 * readings as values: a stub port answers `failed` and the workflow is asked
 * what it did.
 */

/** A port that answers exactly what a test tells it to. */
const stubRecord = (over: Partial<SliceSpendRecord> = {}): SliceSpendRecord => ({
  location: () => answered('/tmp/nowhere/slice-spend.jsonl'),
  sessions: async () => answered([]),
  append: async () => answered(undefined),
  lines: async () => answered([]),
  ...over,
});

/** One assistant turn carrying a usage. */
const turn = (gitBranch: string, inputTokens: number): TranscriptLine => ({
  type: 'assistant',
  gitBranch,
  message: { model: 'claude-opus-5', usage: { input_tokens: inputTokens } },
});

const aRecord = (over: Partial<SliceSpend> = {}): SliceSpend => ({
  branch: 'feature/a',
  at: '2026-09-15T10:00:00.000Z',
  tokens: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
  turns: 1,
  models: ['claude-opus-5'],
  ...over,
});

describe('recordSliceSpend refuses rather than recording a zero', () => {
  it('says transcripts-unreadable when the directory could not be read', async () => {
    // READ THE EXIT CODE, NOT THE EMPTINESS. An unreadable directory and an
    // empty one are different answers, and only one of them says the run was
    // free. This is the case a caller must never see as `no-turns`.
    const actual = await recordSliceSpend(
      stubRecord({ sessions: async (): Promise<PortResult<readonly (readonly TranscriptLine[])[]>> => failed() }),
      { worktree: '/desk', branch: 'feature/a', at: '2026-09-15T10:00:00.000Z' },
    );

    expect(actual).toEqual({ ok: false, refusal: 'transcripts-unreadable' });
  });

  it('says no-turns when the transcripts were read and hold none for this branch', async () => {
    const actual = await recordSliceSpend(
      stubRecord({ sessions: async () => answered([[turn('feature/other', 10)]]) }),
      { worktree: '/desk', branch: 'feature/a', at: '2026-09-15T10:00:00.000Z' },
    );

    expect(actual).toEqual({ ok: false, refusal: 'no-turns' });
  });

  it('says write-failed when the record could not be appended', async () => {
    // The sum succeeded and the write did not. Reporting this as `no-turns`
    // would blame the transcript for a full disk.
    const actual = await recordSliceSpend(
      stubRecord({
        sessions: async () => answered([[turn('feature/a', 10)]]),
        append: async (): Promise<PortResult<void>> => failed(),
      }),
      { worktree: '/desk', branch: 'feature/a', at: '2026-09-15T10:00:00.000Z' },
    );

    expect(actual).toEqual({ ok: false, refusal: 'write-failed' });
  });

  it('refuses a run naming no worktree, as it refuses one naming no branch', async () => {
    const actual = await recordSliceSpend(stubRecord(), {
      worktree: '',
      branch: 'feature/a',
      at: '2026-09-15T10:00:00.000Z',
    });

    expect(actual).toEqual({ ok: false, refusal: 'no-branch' });
  });
});

describe('readSliceSpend', () => {
  it('reports an unreadable record as unreadable, never as absent', async () => {
    const actual = await readSliceSpend(
      stubRecord({ lines: async (): Promise<PortResult<readonly string[]>> => failed() }),
      'feature/a',
    );

    expect(actual.state).toBe('unreadable');
    expect(actual.latest).toBeNull();
  });

  it('reports a record it holds', async () => {
    const actual = await readSliceSpend(
      stubRecord({ lines: async () => answered([encodeSliceSpend(aRecord())]) }),
      'feature/a',
    );

    expect(actual.state).toBe('measured');
    expect(actual.latest?.turns).toBe(1);
  });

  // THE GATE THE DOCSTRING PROMISED, BUILT 2026-09-15.
  //
  // `readSliceSpend`'s docstring says "a test pins that this path opens no
  // transcript" and no such test existed — measured across all four spend test
  // files, zero hits. The claim shipped in #918 and read exactly like a gate,
  // which is why it survived a panel, a review and a green CI.
  //
  // It is not a hypothetical. ONE port carries both reads: `sessions()` opens
  // the desk's transcripts and `lines()` opens the record, so this function can
  // reach a `.jsonl` with no signature change and no reviewer noticing. The
  // board re-deriving per refresh would pass every correctness test above and
  // reintroduce the cost the record exists to remove — 90-250 ms per slice
  // against a 5 s pulse.
  //
  // So the stub COUNTS rather than asserting a returned value: a read that
  // happens and is discarded still costs what the record was written to avoid.
  it('opens no transcript — the read never reaches sessions()', async () => {
    let sessionsCalls = 0;

    const actual = await readSliceSpend(
      stubRecord({
        sessions: async () => {
          sessionsCalls += 1;
          return answered([]);
        },
        lines: async () => answered([encodeSliceSpend(aRecord())]),
      }),
      'feature/a',
    );

    expect(sessionsCalls).toBe(0);
    expect(actual.state).toBe('measured');
  });

  // The same gate on the path that has nothing to read: an absent record must
  // not become a reason to fall back to the transcripts.
  it('opens no transcript even when the record is absent', async () => {
    let sessionsCalls = 0;

    const actual = await readSliceSpend(
      stubRecord({
        sessions: async () => {
          sessionsCalls += 1;
          return answered([[turn('feature/a', 10)]]);
        },
        lines: async () => answered([]),
      }),
      'feature/a',
    );

    expect(sessionsCalls).toBe(0);
    expect(actual.state).toBe('absent');
  });
});

describe('the lines a sum declines to count', () => {
  it('skips a blank line in the record without counting it unreadable', () => {
    // A trailing newline is not a torn record, and counting it would report
    // damage on every well-formed file.
    const actual = readSpend(['', '   ', encodeSliceSpend(aRecord())], 'feature/a');

    expect(actual.unreadable).toBe(0);
    expect(actual.history).toHaveLength(1);
  });

  it('skips an assistant turn whose message is not an object', () => {
    // A line shaped like a turn and carrying no message describes nothing. It
    // is dropped rather than charged as a zero-token turn, which would inflate
    // the turn count with turns nobody took.
    const actual = sliceTokens([
      [
        { type: 'assistant', gitBranch: 'feature/a', message: null },
        { type: 'assistant', gitBranch: 'feature/a', message: 'not an object' },
        turn('feature/a', 5),
      ],
    ]);

    expect(actual).toHaveLength(1);
    expect(actual[0]?.turns).toBe(1);
    expect(actual[0]?.tokens.inputTokens).toBe(5);
  });
});
