import { describe, expect, it } from 'vitest';

import { CharterSchema } from '../src/entities/charter.js';
import {
  CONTEXT_USAGE_FIELDS,
  agentIsSpent,
  contextTokensFromUsage,
  contextVerdict,
  hasContextForAnotherSlice,
  type ContextReadings,
} from '../src/rules/spend.js';

/** A million-token window, the one the plan's measurement was taken against. */
const WINDOW = 1_000_000;

const readings = (over: Partial<ContextReadings> = {}): ContextReadings => ({
  contextTokens: 100_000,
  ...over,
});

/** Bounds a person declared: a ceiling, and the window it is a fraction of. */
const bounds = (contextCeiling: number, contextWindow: number = WINDOW) => ({
  contextCeiling,
  contextWindow,
});

describe('contextTokensFromUsage', () => {
  it('sums the three input fields and ignores what the turn produced', () => {
    // The plan's measurement, 2026-09-03: 642,532 read back plus what the turn
    // added is 643,808 — 64.4% of a 1M window.
    const actual = contextTokensFromUsage({
      input_tokens: 4,
      cache_read_input_tokens: 642_532,
      cache_creation_input_tokens: 1_272,
      output_tokens: 9_999,
    });

    expect(actual).toBe(643_808);
  });

  it('sums whichever of the three fields a turn carries', () => {
    expect(contextTokensFromUsage({ cache_read_input_tokens: 500 })).toBe(500);
    expect(contextTokensFromUsage({ input_tokens: 7 })).toBe(7);
  });

  it('names the three fields it reads and does not name output', () => {
    expect(CONTEXT_USAGE_FIELDS).toEqual([
      'input_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
    ]);
    expect(CONTEXT_USAGE_FIELDS).not.toContain('output_tokens');
  });

  it('answers null — never zero — for a usage carrying none of the fields', () => {
    // A renamed field must reach `unknown`, not report a full agent as empty.
    expect(contextTokensFromUsage({ output_tokens: 12, total_tokens: 900 })).toBeNull();
    expect(contextTokensFromUsage({})).toBeNull();
  });

  it('answers null for anything that is not a usage object', () => {
    expect(contextTokensFromUsage(null)).toBeNull();
    expect(contextTokensFromUsage(undefined)).toBeNull();
    expect(contextTokensFromUsage('642532')).toBeNull();
    expect(contextTokensFromUsage([642_532])).toBeNull();
  });

  it('drops a field that is not a finite non-negative number without poisoning the sum', () => {
    const actual = contextTokensFromUsage({
      input_tokens: Number.NaN,
      cache_read_input_tokens: 600,
      cache_creation_input_tokens: -5,
    });

    expect(actual).toBe(600);
  });

  it('reports a genuine zero as zero, which is not the same as unread', () => {
    expect(contextTokensFromUsage({ input_tokens: 0 })).toBe(0);
  });
});

describe('contextVerdict', () => {
  it('reads a reading below the ceiling as ample', () => {
    const actual = contextVerdict(readings({ contextTokens: 643_808 }), bounds(0.8));

    expect(actual).toBe('ample');
  });

  it('reads a reading past the ceiling as spent', () => {
    const actual = contextVerdict(readings({ contextTokens: 880_000 }), bounds(0.8));

    expect(actual).toBe('spent');
  });

  it('reads a reading exactly at the ceiling as spent', () => {
    // `>=`, not `>`: a ceiling of 1 on a full window must answer spent, or the
    // agent with nothing left reads ample at the one reading that matters.
    expect(contextVerdict(readings({ contextTokens: 800_000 }), bounds(0.8))).toBe(
      'spent',
    );
    expect(contextVerdict(readings({ contextTokens: WINDOW }), bounds(1))).toBe('spent');
  });

  it('answers unknown — never ample — when no tokens could be read', () => {
    // Silence is not headroom. This is the assertion the plan names.
    expect(contextVerdict(readings({ contextTokens: null }), bounds(0.8))).toBe(
      'unknown',
    );
  });

  it('answers unknown — never ample — when the charter states no window', () => {
    // Measured 2026-09-04: a transcript turn names its model and no key in the
    // file matches `window`. So an undeclared window is the estate today, and
    // it must read unknown rather than be judged against a guessed number.
    expect(contextVerdict(readings(), bounds(0.8, 0))).toBe('unknown');
    expect(contextVerdict(readings(), bounds(0.8, Number.NaN))).toBe('unknown');
    expect(contextVerdict(readings(), bounds(0.8, Number.POSITIVE_INFINITY))).toBe('unknown');
  });

  it('answers unknown for an unusable reading rather than throwing', () => {
    expect(contextVerdict(readings({ contextTokens: Number.NaN }), bounds(0.8))).toBe(
      'unknown',
    );
    expect(contextVerdict(readings({ contextTokens: -1 }), bounds(0.8))).toBe('unknown');
  });

  it('answers unknown for a ceiling that is not a usable fraction', () => {
    expect(contextVerdict(readings(), bounds(0))).toBe('unknown');
    expect(contextVerdict(readings(), bounds(Number.NaN))).toBe('unknown');
  });

  it('exposes no percentage anywhere in its answer', () => {
    // The assertion the plan names: the domain carries a verdict, never the
    // number. A caller wanting 64% renders it from the reading it already holds.
    const answers = [
      contextVerdict(readings({ contextTokens: 10 }), bounds(0.8)),
      contextVerdict(readings({ contextTokens: 900_000 }), bounds(0.8)),
      contextVerdict(readings({ contextTokens: null }), bounds(0.8)),
    ];

    expect(answers).toEqual(['ample', 'spent', 'unknown']);
    for (const answer of answers) expect(typeof answer).toBe('string');
  });
});

describe('contextVerdict against a charter', () => {
  it('reads an agent that declared nothing as unknown, whatever it has spent', () => {
    // The estate today: no charter names a window, so every existing worker
    // answers unknown — handed no work on that basis, and ended on none either.
    const declared = CharterSchema.parse({ name: 'a', prompt: 'p.sh' }).bounds;

    expect(declared.contextCeiling).toBe(1);
    expect(declared.contextWindow).toBe(0);
    expect(contextVerdict(readings({ contextTokens: 10 }), declared)).toBe('unknown');
    expect(contextVerdict(readings({ contextTokens: 5_000_000 }), declared)).toBe('unknown');
  });

  it('honours the ceiling and window a person declared', () => {
    const declared = CharterSchema.parse({
      name: 'a',
      prompt: 'p.sh',
      bounds: { contextCeiling: 0.5, contextWindow: WINDOW, atCeiling: 'finish' },
    }).bounds;

    expect(contextVerdict(readings({ contextTokens: 600_000 }), declared)).toBe('spent');
    expect(contextVerdict(readings({ contextTokens: 400_000 }), declared)).toBe('ample');
  });

  it('spends the same reading differently against two declared windows', () => {
    // Why the window is declared and not read off the model name: this repo
    // runs `claude-opus-5` at both 200k and 1M, five times apart.
    const at200k = CharterSchema.parse({
      name: 'a',
      prompt: 'p.sh',
      bounds: { contextCeiling: 0.8, contextWindow: 200_000, atCeiling: 'finish' },
    }).bounds;
    const at1m = CharterSchema.parse({
      name: 'b',
      prompt: 'p.sh',
      bounds: { contextCeiling: 0.8, contextWindow: WINDOW, atCeiling: 'finish' },
    }).bounds;
    const spend = readings({ contextTokens: 643_808 });

    expect(contextVerdict(spend, at200k)).toBe('spent');
    expect(contextVerdict(spend, at1m)).toBe('ample');
  });

  it('refuses a charter whose window is not a whole non-negative count', () => {
    const withWindow = (contextWindow: unknown) =>
      CharterSchema.safeParse({
        name: 'a',
        prompt: 'p.sh',
        bounds: { contextCeiling: 0.8, contextWindow, atCeiling: 'finish' },
      }).success;

    expect(withWindow(200_000)).toBe(true);
    expect(withWindow(0)).toBe(true);
    expect(withWindow(-1)).toBe(false);
    expect(withWindow(1.5)).toBe(false);
  });
});

describe('hasContextForAnotherSlice and agentIsSpent', () => {
  it('gives work only on ample', () => {
    expect(hasContextForAnotherSlice('ample')).toBe(true);
    expect(hasContextForAnotherSlice('spent')).toBe(false);
    expect(hasContextForAnotherSlice('unknown')).toBe(false);
  });

  it('declares an ending only on spent', () => {
    expect(agentIsSpent('spent')).toBe(true);
    expect(agentIsSpent('ample')).toBe(false);
    expect(agentIsSpent('unknown')).toBe(false);
  });

  it('answers false to both for unknown, which is the asymmetry', () => {
    // `unknown` is neither permission nor a finding. An agent whose context
    // cannot be read is reported, and a person decides.
    expect(hasContextForAnotherSlice('unknown')).toBe(false);
    expect(agentIsSpent('unknown')).toBe(false);
  });
});
