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
  contextWindow: WINDOW,
  ...over,
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
    const actual = contextVerdict(readings({ contextTokens: 643_808 }), { contextCeiling: 0.8 });

    expect(actual).toBe('ample');
  });

  it('reads a reading past the ceiling as spent', () => {
    const actual = contextVerdict(readings({ contextTokens: 880_000 }), { contextCeiling: 0.8 });

    expect(actual).toBe('spent');
  });

  it('reads a reading exactly at the ceiling as spent', () => {
    // `>=`, not `>`: a ceiling of 1 on a full window must answer spent, or the
    // agent with nothing left reads ample at the one reading that matters.
    expect(contextVerdict(readings({ contextTokens: 800_000 }), { contextCeiling: 0.8 })).toBe(
      'spent',
    );
    expect(contextVerdict(readings({ contextTokens: WINDOW }), { contextCeiling: 1 })).toBe('spent');
  });

  it('answers unknown — never ample — when no tokens could be read', () => {
    // Silence is not headroom. This is the assertion the plan names.
    expect(contextVerdict(readings({ contextTokens: null }), { contextCeiling: 0.8 })).toBe(
      'unknown',
    );
  });

  it('answers unknown — never ample — when no window was stated', () => {
    expect(contextVerdict(readings({ contextWindow: null }), { contextCeiling: 0.8 })).toBe(
      'unknown',
    );
    expect(contextVerdict(readings({ contextWindow: 0 }), { contextCeiling: 0.8 })).toBe('unknown');
  });

  it('answers unknown for an unusable reading rather than throwing', () => {
    expect(contextVerdict(readings({ contextTokens: Number.NaN }), { contextCeiling: 0.8 })).toBe(
      'unknown',
    );
    expect(contextVerdict(readings({ contextTokens: -1 }), { contextCeiling: 0.8 })).toBe('unknown');
    expect(
      contextVerdict(readings({ contextWindow: Number.POSITIVE_INFINITY }), {
        contextCeiling: 0.8,
      }),
    ).toBe('unknown');
  });

  it('answers unknown for a ceiling that is not a usable fraction', () => {
    expect(contextVerdict(readings(), { contextCeiling: 0 })).toBe('unknown');
    expect(contextVerdict(readings(), { contextCeiling: Number.NaN })).toBe('unknown');
  });

  it('exposes no percentage anywhere in its answer', () => {
    // The assertion the plan names: the domain carries a verdict, never the
    // number. A caller wanting 64% renders it from the reading it already holds.
    const answers = [
      contextVerdict(readings({ contextTokens: 10 }), { contextCeiling: 0.8 }),
      contextVerdict(readings({ contextTokens: 900_000 }), { contextCeiling: 0.8 }),
      contextVerdict(readings({ contextTokens: null }), { contextCeiling: 0.8 }),
    ];

    expect(answers).toEqual(['ample', 'spent', 'unknown']);
    for (const answer of answers) expect(typeof answer).toBe('string');
  });
});

describe('contextVerdict against a charter', () => {
  it('reads an undeclared agent as spent only at a full window', () => {
    // The estate today: nothing is declared, so the schema's default of 1
    // applies and no existing worker changes behaviour.
    const { bounds } = CharterSchema.parse({ name: 'a', prompt: 'p.sh' });

    expect(bounds.contextCeiling).toBe(1);
    expect(contextVerdict(readings({ contextTokens: 999_999 }), bounds)).toBe('ample');
    expect(contextVerdict(readings({ contextTokens: WINDOW }), bounds)).toBe('spent');
  });

  it('honours a ceiling a person declared', () => {
    const { bounds } = CharterSchema.parse({
      name: 'a',
      prompt: 'p.sh',
      bounds: { contextCeiling: 0.5, atCeiling: 'finish' },
    });

    expect(contextVerdict(readings({ contextTokens: 600_000 }), bounds)).toBe('spent');
    expect(contextVerdict(readings({ contextTokens: 400_000 }), bounds)).toBe('ample');
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
