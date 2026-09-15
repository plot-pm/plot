import { describe, expect, it } from 'vitest';

import { CONTEXT_USAGE_FIELDS, contextTokensFromUsage } from '../src/rules/spend.js';
import {
  DETACHED_BRANCH,
  SPEND_USAGE_FIELDS,
  chargedBranch,
  sliceTokens,
  tokensForBranch,
  type TranscriptLine,
} from '../src/rules/slice-tokens.js';

/** One assistant turn, as a transcript writes it. */
const turn = (
  gitBranch: string,
  usage: Record<string, unknown> | null = { input_tokens: 1 },
  over: Partial<TranscriptLine> & { model?: string } = {},
): TranscriptLine => {
  const { model = 'claude-opus-5', ...rest } = over;
  return {
    type: 'assistant',
    gitBranch,
    message: usage === null ? { model } : { model, usage },
    ...rest,
  };
};

/** The four counters a real turn carries — measured shape, 2026-09-15. */
const usage = (over: Partial<Record<string, number>> = {}) => ({
  input_tokens: 2,
  output_tokens: 169,
  cache_creation_input_tokens: 80_247,
  cache_read_input_tokens: 13_236,
  ...over,
});

describe('SPEND_USAGE_FIELDS', () => {
  it('counts output_tokens, which the context ceiling deliberately excludes', () => {
    // THE TWO LISTS MUST DIFFER BY EXACTLY THIS FIELD. A context ceiling that
    // gained `output_tokens` would report agents as spent that are not; a spend
    // that lost it would under-report what a run generated.
    const spendFields = SPEND_USAGE_FIELDS.map(([, field]) => field);

    expect(spendFields).toContain('output_tokens');
    expect(CONTEXT_USAGE_FIELDS).not.toContain('output_tokens');
    expect([...spendFields].sort()).toEqual([...CONTEXT_USAGE_FIELDS, 'output_tokens'].sort());
  });
});

describe('sliceTokens', () => {
  it('sums all four counters over every turn of a branch', () => {
    const actual = sliceTokens([[turn('feature/a', usage()), turn('feature/a', usage())]]);

    expect(actual).toEqual([
      {
        branch: 'feature/a',
        tokens: {
          inputTokens: 4,
          outputTokens: 338,
          cacheCreationTokens: 160_494,
          cacheReadTokens: 26_472,
        },
        turns: 2,
        models: ['claude-opus-5'],
      },
    ]);
  });

  it('writes NO summed fifth field — asserted on the key set, not on prose', () => {
    // A total beside the four is a two-line change no review would flag, and
    // cache reads are 99.36% of one, so it would be a cache-read count wearing
    // a cost's name.
    const [only] = sliceTokens([[turn('feature/a', usage())]]);

    expect(Object.keys(only!.tokens).sort()).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'inputTokens',
      'outputTokens',
    ]);
  });

  it('keeps each branch apart when one worker hops between two', () => {
    // A worker does not exit between slices. A sum taken at worker exit would
    // charge both branches to whichever it held last.
    const actual = sliceTokens([
      [
        turn('feature/a', usage({ input_tokens: 10 })),
        turn('feature/b', usage({ input_tokens: 20 })),
      ],
    ]);

    expect(actual.map((entry) => [entry.branch, entry.tokens.inputTokens])).toEqual([
      ['feature/a', 10],
      ['feature/b', 20],
    ]);
  });

  it('charges a B → HEAD → B detour to B — the shape that actually occurs', () => {
    // THE FIXTURE THE PLAN PINS. Measured over 1,320 worker transcripts: 74
    // carry a HEAD segment, 40 return to the same branch, and 0 sit between two
    // DIFFERENT branches. A two-distinct-branch fixture does not contain this
    // case at all, so the obvious fixture tests a shape that never happens.
    const actual = sliceTokens([
      [
        turn('feature/a', usage({ input_tokens: 5 })),
        turn(DETACHED_BRANCH, usage({ input_tokens: 7 })),
        turn('feature/a', usage({ input_tokens: 11 })),
      ],
    ]);

    expect(actual).toHaveLength(1);
    expect(actual[0]!.branch).toBe('feature/a');
    expect(actual[0]!.tokens.inputTokens).toBe(23);
    expect(actual[0]!.turns).toBe(3);
  });

  it('charges a leading HEAD segment to no slice at all', () => {
    // 34 of the 74 measured files carry a HEAD segment with no preceding real
    // branch. That is the honest `none` case, not a reason to guess forward.
    const actual = sliceTokens([
      [turn(DETACHED_BRANCH, usage({ input_tokens: 9 })), turn('feature/a', usage())],
    ]);

    expect(actual.map((entry) => entry.branch)).toEqual(['feature/a']);
    expect(actual[0]!.tokens.inputTokens).toBe(2);
  });

  it('sums EVERY main session of a desk, not just one', () => {
    // The brief's correction to the plan, measured over every dispatch desk on
    // this machine: 40 of 41 hold MORE THAN ONE main session, and the largest
    // is a median 80.8% of the total. A sum keyed on one session id reads one
    // file and silently omits the rest.
    const actual = tokensForBranch(
      [
        [turn('feature/a', usage({ input_tokens: 100 }))],
        [turn('feature/a', usage({ input_tokens: 200 }))],
        [turn('feature/a', usage({ input_tokens: 300 }))],
      ],
      'feature/a',
    );

    expect(actual?.tokens.inputTokens).toBe(600);
    expect(actual?.turns).toBe(3);
  });

  it('excludes a subagent turn even when it names the branch', () => {
    // The half of `spend.ts:42-50` that DOES transfer: a subagent's transcript
    // belongs to no one.
    const actual = tokensForBranch(
      [
        [
          turn('feature/a', usage({ input_tokens: 1 })),
          turn('feature/a', usage({ input_tokens: 999 }), { isSidechain: true }),
        ],
      ],
      'feature/a',
    );

    expect(actual?.tokens.inputTokens).toBe(1);
    expect(actual?.turns).toBe(1);
  });

  it('records every model it saw, in first-seen order', () => {
    const actual = tokensForBranch(
      [
        [
          turn('feature/a', usage(), { model: 'claude-opus-5' }),
          turn('feature/a', usage(), { model: 'claude-sonnet-5' }),
          turn('feature/a', usage(), { model: 'claude-opus-5' }),
        ],
      ],
      'feature/a',
    );

    expect(actual?.models).toEqual(['claude-opus-5', 'claude-sonnet-5']);
  });

  it('answers null for a branch that contributed no turn — never a zero', () => {
    // A recorded zero is indistinguishable from a free run.
    expect(tokensForBranch([[turn('feature/a', usage())]], 'feature/other')).toBeNull();
    expect(tokensForBranch([], 'feature/a')).toBeNull();
  });

  it('answers null where every turn carried an unrecognised usage', () => {
    // The transcript is the runtime's private format and may rename a field.
    // A renamed field must read as absent, not as a run that cost nothing.
    expect(tokensForBranch([[turn('feature/a', { renamed_tokens: 5 })]], 'feature/a')).toBeNull();
    expect(tokensForBranch([[turn('feature/a', null)]], 'feature/a')).toBeNull();
  });

  it('drops a field that is not a finite non-negative number without poisoning the sum', () => {
    const actual = tokensForBranch(
      [
        [
          turn('feature/a', {
            input_tokens: Number.NaN,
            output_tokens: -5,
            cache_creation_input_tokens: Number.POSITIVE_INFINITY,
            cache_read_input_tokens: 42,
          }),
        ],
      ],
      'feature/a',
    );

    expect(actual?.tokens).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 42,
    });
  });

  it('ignores a line that is not an assistant turn', () => {
    const actual = tokensForBranch(
      [
        [
          { type: 'user', gitBranch: 'feature/a', message: { usage: usage() } },
          turn('feature/a', usage({ input_tokens: 3 })),
        ],
      ],
      'feature/a',
    );

    expect(actual?.turns).toBe(1);
    expect(actual?.tokens.inputTokens).toBe(3);
  });

  it('leaves the context ceiling reading untouched', () => {
    // THE REGRESSION LOCK. This plan adds a reading beside `contextSpend`; it
    // must not disturb the one a ceiling verdict depends on.
    expect(contextTokensFromUsage(usage())).toBe(2 + 80_247 + 13_236);
  });
});

describe('chargedBranch', () => {
  it('charges a real branch to itself', () => {
    expect(chargedBranch('feature/a', 'feature/before')).toBe('feature/a');
  });

  it('charges HEAD to what preceded it, and never looks ahead', () => {
    // No lookahead is STRUCTURAL: at `seal_declaration` the next branch has not
    // been chosen, so a forward-looking rule could not be computed at all.
    expect(chargedBranch(DETACHED_BRANCH, 'feature/a')).toBe('feature/a');
    expect(chargedBranch(DETACHED_BRANCH, null)).toBeNull();
  });

  it('treats an absent or empty branch as carrying no new attribution', () => {
    expect(chargedBranch(undefined, 'feature/a')).toBe('feature/a');
    expect(chargedBranch('', 'feature/a')).toBe('feature/a');
    expect(chargedBranch(42, null)).toBeNull();
  });
});
